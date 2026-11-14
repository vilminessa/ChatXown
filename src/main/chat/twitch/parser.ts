import type { Badge, EmoteDef, Fragment } from '../../../shared/types'

export interface IrcMessage {
  tags: Record<string, string>
  prefix?: string
  command: string
  params: string[]
}

/** IRCv3 tag value unescaping (see spec: `\\s \\: \\\\ \\r \\n`). */
export function unescapeTagValue(value: string): string {
  return value.replace(/\\(.)/g, (_match, char: string) => {
    switch (char) {
      case 's':
        return ' '
      case ':':
        return ';'
      case 'r':
        return '\r'
      case 'n':
        return '\n'
      case '\\':
        return '\\'
      default:
        return char
    }
  })
}

/**
 * Parses a single IRC line (Twitch dialect: optional IRCv3 tags, optional prefix,
 * command and params with a trailing `:` param).
 */
export function parseIrcLine(line: string): IrcMessage | null {
  let rest = line.replace(/[\r\n]+$/, '')
  if (!rest) return null

  const tags: Record<string, string> = {}

  if (rest.startsWith('@')) {
    const end = rest.indexOf(' ')
    if (end === -1) return null
    for (const pair of rest.slice(1, end).split(';')) {
      if (!pair) continue
      const eq = pair.indexOf('=')
      if (eq === -1) tags[pair] = ''
      else tags[pair.slice(0, eq)] = unescapeTagValue(pair.slice(eq + 1))
    }
    rest = rest.slice(end + 1)
  }

  let prefix: string | undefined
  if (rest.startsWith(':')) {
    const end = rest.indexOf(' ')
    if (end === -1) {
      return { tags, prefix: rest.slice(1), command: '', params: [] }
    }
    prefix = rest.slice(1, end)
    rest = rest.slice(end + 1)
  }

  const params: string[] = []
  const firstSpace = rest.indexOf(' ')
  let command = rest
  if (firstSpace !== -1) {
    command = rest.slice(0, firstSpace)
    rest = rest.slice(firstSpace + 1)
  } else {
    rest = ''
  }

  while (rest.length > 0) {
    if (rest.startsWith(':')) {
      params.push(rest.slice(1))
      break
    }
    const sp = rest.indexOf(' ')
    if (sp === -1) {
      params.push(rest)
      break
    }
    params.push(rest.slice(0, sp))
    rest = rest.slice(sp + 1).replace(/^ +/, '')
  }

  return { tags, prefix, command: command.toUpperCase(), params }
}

export function twitchEmoteUrl(id: string): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`
}

export function badgeUrl(setId: string, version: string): string {
  return `https://static-cdn.jtvnw.net/badges/v1/${setId}/${version}/1`
}

const BADGE_TITLES: Record<string, string> = {
  broadcaster: 'Стример',
  moderator: 'Модератор',
  vip: 'VIP',
  subscriber: 'Подписчик',
  founder: 'Основатель канала',
  prime: 'Prime',
  premium: 'Turbo',
  turbo: 'Turbo',
  staff: 'Twitch Staff',
  admin: 'Twitch Admin',
  global_mod: 'Global Moderator',
  partner: 'Partner',
  bits: 'Bits',
  'bits-leader': 'Лидер Bits',
  'sub-gift-leader': 'Лидер подарков',
  'sub-gifter': 'Даритель подписок',
  'no_audio': 'Без звука',
  'no_video': 'Без видео',
  predictions: 'Прогнозы'
}

export function parseBadges(raw: string | undefined): Badge[] {
  if (!raw) return []
  const out: Badge[] = []
  for (const item of raw.split(',')) {
    if (!item) continue
    const slash = item.indexOf('/')
    const setId = slash === -1 ? item : item.slice(0, slash)
    const version = slash === -1 ? '1' : item.slice(slash + 1)
    if (!setId) continue
    out.push({ id: setId, url: badgeUrl(setId, version), title: BADGE_TITLES[setId] })
  }
  return out
}

const USER_COLORS = [
  '#ff5b5b', '#ff8f40', '#ffd23f', '#7bd88f', '#3ddc97',
  '#4ecdc4', '#4aa8ff', '#7b8cff', '#b388ff', '#ff6bd6'
]

/** Deterministic color for users that never picked one (same as old Twitch behavior). */
export function colorFromName(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length]
}

/**
 * Builds message fragments from raw text and the `emotes` IRC tag.
 * Twitch reports emote ranges in Unicode code points (inclusive).
 */
export function buildFragments(text: string, emotesTag?: string): Fragment[] {
  if (!text) return []

  const codePoints = Array.from(text)
  const slots: Array<{ url: string; alt: string; run: number } | null> = new Array(
    codePoints.length
  ).fill(null)
  let run = 0

  if (emotesTag) {
    for (const chunk of emotesTag.split('/')) {
      if (!chunk) continue
      const colon = chunk.indexOf(':')
      if (colon === -1) continue
      const id = chunk.slice(0, colon)
      const ranges = chunk.slice(colon + 1)
      if (!id || !ranges) continue
      const url = twitchEmoteUrl(id)
      for (const range of ranges.split(',')) {
        const dash = range.indexOf('-')
        if (dash === -1) continue
        const start = Number(range.slice(0, dash))
        const end = Number(range.slice(dash + 1))
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue
        const last = Math.min(end, codePoints.length - 1)
        if (start < 0 || start > last) continue
        const alt = codePoints.slice(start, last + 1).join('')
        run += 1
        for (let i = start; i <= last; i += 1) slots[i] = { url, alt, run }
      }
    }
  }

  const out: Fragment[] = []
  let buffer = ''
  let lastRun = -1
  for (let i = 0; i < codePoints.length; i += 1) {
    const slot = slots[i]
    if (slot) {
      if (buffer) {
        out.push({ type: 'text', text: buffer })
        buffer = ''
      }
      if (slot.run !== lastRun) {
        out.push({ type: 'emote', url: slot.url, alt: slot.alt })
        lastRun = slot.run
      }
    } else {
      buffer += codePoints[i]
      lastRun = -1
    }
  }
  if (buffer) out.push({ type: 'text', text: buffer })

  return out
}

/** Replaces whitespace-separated words that match third-party emote names. */
export function applyWordEmotes(
  fragments: Fragment[],
  emotes: Map<string, EmoteDef>
): Fragment[] {
  if (emotes.size === 0) return fragments
  const out: Fragment[] = []
  const pushText = (text: string): void => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.type === 'text') last.text += text
    else out.push({ type: 'text', text })
  }
  for (const fragment of fragments) {
    if (fragment.type !== 'text') {
      out.push(fragment)
      continue
    }
    for (const part of fragment.text.split(/(\s+)/)) {
      if (!part) continue
      const emote = emotes.get(part)
      if (emote) out.push({ type: 'emote', url: emote.url, alt: emote.name })
      else pushText(part)
    }
  }
  return out
}

export function fragmentsToText(fragments: Fragment[]): string {
  return fragments.map((f) => (f.type === 'text' ? f.text : f.alt)).join('')
}
