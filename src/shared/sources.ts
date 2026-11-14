import type { Platform } from './types'

export interface ParsedSource {
  platform: Platform
  channel: string
  error?: string
}

const YT_VIDEO_RE = /^[A-Za-z0-9_-]{11}$/
const YT_CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/
const YT_HANDLE_RE = /^@[\p{L}\p{N}_.-]{2,40}$/u

function parseYouTubeInput(input: string): ParsedSource {
  const compact = input.replace(/\s+/g, '')
  if (!compact) return { platform: 'youtube', channel: '', error: 'Пустая ссылка или название канала' }

  if (YT_HANDLE_RE.test(compact)) return { platform: 'youtube', channel: compact }
  if (YT_CHANNEL_ID_RE.test(compact)) return { platform: 'youtube', channel: compact }
  if (YT_VIDEO_RE.test(compact)) return { platform: 'youtube', channel: compact }

  const url = compact
    .replace(/^https?:\/\//i, '')
    .replace(/^(?:www\.|m\.|music\.)/i, '')

  let match = url.match(/^youtu\.be\/([A-Za-z0-9_-]{11})/)
  if (match) return { platform: 'youtube', channel: match[1] }

  match = url.match(/^youtube(?:-nocookie)?\.com\/watch\?(.*)$/)
  if (match) {
    const videoId = new URLSearchParams(match[1]).get('v')
    if (videoId && YT_VIDEO_RE.test(videoId)) return { platform: 'youtube', channel: videoId }
  }

  match = url.match(
    /^youtube(?:-nocookie)?\.com\/(?:live|shorts|embed|v)\/([A-Za-z0-9_-]{11})/
  )
  if (match) return { platform: 'youtube', channel: match[1] }

  match = url.match(/^youtube(?:-nocookie)?\.com\/(@[\p{L}\p{N}_.-]+)/u)
  if (match) return { platform: 'youtube', channel: match[1] }

  match = url.match(/^youtube(?:-nocookie)?\.com\/channel\/(UC[A-Za-z0-9_-]{22})/)
  if (match) return { platform: 'youtube', channel: match[1] }

  // Legacy /c/ and /user/ links are resolved through the YouTube resolver at runtime.
  if (/^youtube(?:-nocookie)?\.com\/(?:c|user)\//i.test(url)) {
    return { platform: 'youtube', channel: `https://${url.replace(/[?#].*$/, '')}` }
  }

  return {
    platform: 'youtube',
    channel: compact,
    error: 'Укажите @handle, ID канала (UC…), ссылку на канал или видео'
  }
}

export function parseSourceInput(input: string, forced?: Platform): ParsedSource {
  const raw = (input ?? '').trim()
  if (!raw) return { platform: 'twitch', channel: '', error: 'Пустая ссылка или название канала' }

  const platform: Platform =
    forced ??
    (/youtu\.?be/i.test(raw) ||
    /youtube\.com/i.test(raw) ||
    /^@/.test(raw) ||
    YT_CHANNEL_ID_RE.test(raw.replace(/\s+/g, ''))
      ? 'youtube'
      : 'twitch')

  if (platform === 'youtube') {
    return parseYouTubeInput(raw)
  }

  let value = raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^twitch\.tv\//i, '')
    .replace(/^m\.twitch\.tv\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '')
  value = value.split('/')[0].replace(/^#/, '').toLowerCase()

  if (!/^[a-z0-9_]{2,25}$/.test(value)) {
    return { platform, channel: value, error: 'Некорректное имя канала Twitch' }
  }
  return { platform, channel: value }
}
