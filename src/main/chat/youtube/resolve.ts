import { getInnertube } from './runtime'

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/
const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/
const CHANNEL_CACHE_TTL = 6 * 60 * 60 * 1000

export interface LiveTarget {
  videoId: string
  title?: string
  channelId?: string
  channelTitle?: string
}

export type YouTubeTarget =
  | ({ kind: 'video' } & LiveTarget)
  | { kind: 'offline'; channelTitle?: string }

interface ChannelCacheEntry {
  ts: number
  browseId: string
}

const channelCache = new Map<string, ChannelCacheEntry>()

function cacheKey(input: string): string {
  return input.trim().toLowerCase()
}

async function resolveBrowseId(input: string): Promise<string> {
  const key = cacheKey(input)
  const cached = channelCache.get(key)
  if (cached && Date.now() - cached.ts < CHANNEL_CACHE_TTL) return cached.browseId

  const yt = await getInnertube()
  let browseId: string | undefined

  if (CHANNEL_ID_RE.test(input)) {
    browseId = input
  } else if (input.startsWith('@')) {
    const endpoint = await yt.resolveURL(`https://www.youtube.com/${input}`)
    browseId = endpoint?.payload?.browseId
  } else if (/^https?:\/\//i.test(input)) {
    const endpoint = await yt.resolveURL(input)
    browseId = endpoint?.payload?.browseId
  }

  if (!browseId) throw new Error(`Канал ${input} не найден`)
  channelCache.set(key, { ts: Date.now(), browseId })
  return browseId
}

function badgeLabels(item: any): string {
  const overlays = Array.isArray(item?.content_image?.overlays) ? item.content_image.overlays : []
  const overlayBadges = overlays.flatMap((overlay: any) =>
    Array.isArray(overlay?.badges) ? overlay.badges : []
  )
  const directBadges = Array.isArray(item?.badges) ? item.badges : []
  return [...overlayBadges, ...directBadges]
    .map(
      (badge: any) =>
        `${badge?.icon_name ?? ''} ${badge?.text ?? ''} ${badge?.metadata?.badge_id ?? ''}`
    )
    .join(' ')
    .toUpperCase()
}

function isLiveItem(item: any): boolean {
  if (typeof item?.is_live === 'boolean') return item.is_live
  return /\bLIVE\b/.test(badgeLabels(item))
}

function titleOf(item: any): string | undefined {
  const title = item?.title?.toString?.() ?? item?.metadata?.title?.toString?.()
  return title?.trim() || undefined
}

async function findLive(browseId: string): Promise<YouTubeTarget> {
  const yt = await getInnertube()
  const channel = await yt.getChannel(browseId)
  const channelTitle = channel?.metadata?.title?.toString?.()?.trim() || undefined

  let videos: any[] = []
  try {
    const feed = await channel.getLiveStreams()
    videos = Array.isArray(feed?.videos) ? feed.videos : []
  } catch {
    return { kind: 'offline', channelTitle }
  }

  const live = videos.find((item) => isLiveItem(item))
  if (!live) return { kind: 'offline', channelTitle }

  const videoId = live.video_id ?? live.content_id ?? live.id
  if (!videoId || !VIDEO_ID_RE.test(String(videoId))) return { kind: 'offline', channelTitle }

  return {
    kind: 'video',
    videoId: String(videoId),
    title: titleOf(live),
    channelId: browseId,
    channelTitle
  }
}

/**
 * Resolves a canonical YouTube source (video id, channel id, @handle or URL)
 * to the live video currently airing on that channel, if any.
 */
export async function resolveYouTubeTarget(input: string): Promise<YouTubeTarget> {
  const value = input.trim()
  if (VIDEO_ID_RE.test(value)) return { kind: 'video', videoId: value }

  const browseId = await resolveBrowseId(value)
  return findLive(browseId)
}
