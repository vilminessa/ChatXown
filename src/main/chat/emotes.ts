import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EmoteDef, EmoteProviders } from '../../shared/types'

interface CacheEntry {
  ts: number
  emotes: Array<[string, string]>
}

const TTL = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT = 8000

let cacheFile: string | null = null
let diskCache: Record<string, CacheEntry> = {}
let writeTimer: NodeJS.Timeout | null = null

export function initEmoteCache(file: string): void {
  cacheFile = file
  try {
    if (existsSync(file)) {
      diskCache = JSON.parse(readFileSync(file, 'utf8')) as Record<string, CacheEntry>
    }
  } catch {
    diskCache = {}
  }
}

function persist(): void {
  if (!cacheFile || writeTimer) return
  writeTimer = setTimeout(() => {
    writeTimer = null
    try {
      mkdirSync(dirname(cacheFile as string), { recursive: true })
      writeFileSync(cacheFile as string, JSON.stringify(diskCache))
    } catch {
      /* ignore */
    }
  }, 1000)
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) })
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  return res.json()
}

type Pairs = Array<[string, string]>

async function fetch7tv(roomId: string): Promise<Pairs> {
  const json = await getJson(`https://7tv.io/v3/users/twitch/${roomId}`)
  const list: any[] = json?.emote_set?.emotes ?? []
  return list
    .filter((e) => e?.name && e?.data?.host?.url)
    .map((e) => [e.name as string, `https:${e.data.host.url}/2x.webp`] as [string, string])
}

async function fetch7tvGlobal(): Promise<Pairs> {
  const json = await getJson('https://7tv.io/v3/emote-sets/global')
  const list: any[] = json?.emotes ?? []
  return list
    .filter((e) => e?.name && e?.data?.host?.url)
    .map((e) => [e.name as string, `https:${e.data.host.url}/2x.webp`] as [string, string])
}

async function fetchBttv(roomId: string): Promise<Pairs> {
  const json = await getJson(`https://api.betterttv.net/3/cached/users/twitch/${roomId}`)
  const list: any[] = [...(json?.channelEmotes ?? []), ...(json?.sharedEmotes ?? [])]
  return list
    .filter((e) => e?.code && e?.id)
    .map((e) => [e.code as string, `https://cdn.betterttv.net/emote/${e.id}/2x`] as [string, string])
}

async function fetchBttvGlobal(): Promise<Pairs> {
  const list: any[] = await getJson('https://api.betterttv.net/3/cached/emotes/global')
  return list
    .filter((e) => e?.code && e?.id)
    .map((e) => [e.code as string, `https://cdn.betterttv.net/emote/${e.id}/2x`] as [string, string])
}

async function fetchFfz(roomId: string): Promise<Pairs> {
  try {
    const json = await getJson(`https://api.frankerfacez.com/v1/room/id/${roomId}`)
    return ffzPairs(json?.sets)
  } catch {
    return []
  }
}

async function fetchFfzGlobal(): Promise<Pairs> {
  const json = await getJson('https://api.frankerfacez.com/v1/set/global')
  return ffzPairs(json?.sets)
}

function ffzPairs(sets: any): Pairs {
  const out: Pairs = []
  for (const set of Object.values(sets ?? {}) as any[]) {
    for (const emote of set?.emoticons ?? []) {
      const url = emote?.urls?.['2'] ?? emote?.urls?.['1']
      if (emote?.name && url) out.push([emote.name, `https:${url}`])
    }
  }
  return out
}

async function cached(key: string, load: () => Promise<Pairs>): Promise<Pairs> {
  const entry = diskCache[key]
  if (entry && Date.now() - entry.ts < TTL) return entry.emotes
  const emotes = await load()
  if (emotes.length > 0) {
    diskCache[key] = { ts: Date.now(), emotes }
    persist()
  }
  return emotes
}

/**
 * Loads channel + global emotes for enabled providers.
 * Earlier providers win on name collisions (7TV > BTTV > FFZ).
 */
export async function loadEmotes(
  roomId: string,
  providers: EmoteProviders
): Promise<Map<string, EmoteDef>> {
  const none: Pairs = []
  const safe = async (p: Promise<Pairs>): Promise<Pairs> => {
    try {
      return await p
    } catch {
      return []
    }
  }

  const [ffzGlobal, ffzRoom, bttvGlobal, bttvRoom, tvGlobal, tvRoom] = await Promise.all([
    providers.ffz ? safe(cached('ffz:global', fetchFfzGlobal)) : none,
    providers.ffz ? safe(cached(`ffz:${roomId}`, () => fetchFfz(roomId))) : none,
    providers.bttv ? safe(cached('bttv:global', fetchBttvGlobal)) : none,
    providers.bttv ? safe(cached(`bttv:${roomId}`, () => fetchBttv(roomId))) : none,
    providers.sevenTv ? safe(cached('7tv:global', fetch7tvGlobal)) : none,
    providers.sevenTv ? safe(cached(`7tv:${roomId}`, () => fetch7tv(roomId))) : none
  ])

  // Applied in ascending priority: FFZ < BTTV < 7TV, channel set overrides global.
  const result = new Map<string, EmoteDef>()
  const apply = (pairs: Pairs): void => {
    for (const [name, url] of pairs) result.set(name, { name, url })
  }
  apply(ffzGlobal)
  apply(ffzRoom)
  apply(bttvGlobal)
  apply(bttvRoom)
  apply(tvGlobal)
  apply(tvRoom)
  return result
}
