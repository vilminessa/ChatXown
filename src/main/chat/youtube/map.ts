import { randomUUID } from 'node:crypto'
import type {
  Badge,
  ChatAuthor,
  ChatEvent,
  ChatEventKind,
  ClearPayload,
  Fragment
} from '../../../shared/types'
import { colorFromName } from '../twitch/parser'

export interface YouTubeMapContext {
  sourceId: string
  /** canonical source value (@handle, UC…, or video id) */
  channel: string
  /** streamer's channel id, used to detect the broadcaster */
  channelId?: string
}

interface YouTubeAuthorLike {
  name?: string
  id?: string
  badges?: any[]
}

const BADGE_TEXT: Record<string, string> = {
  OWNER: 'Автор',
  MODERATOR: 'Мод',
  VERIFIED: '✓',
  VERIFIED_ARTIST: '✓',
  MEMBER: 'Участник'
}

function bestThumb(thumbs: any[] | undefined): { url: string } | undefined {
  if (!Array.isArray(thumbs) || thumbs.length === 0) return undefined
  let best = thumbs[0]
  for (const thumb of thumbs) {
    if ((thumb?.width ?? 0) * (thumb?.height ?? 0) > (best?.width ?? 0) * (best?.height ?? 0)) {
      best = thumb
    }
  }
  return typeof best?.url === 'string' && best.url ? { url: best.url } : undefined
}

function mapBadges(badges: any[] | undefined): Badge[] {
  if (!Array.isArray(badges)) return []
  const out: Badge[] = []
  for (const badge of badges) {
    if (!badge || typeof badge !== 'object') continue
    const icon = String(badge.icon_type ?? '').toUpperCase()
    const title = String(badge.label || badge.tooltip || BADGE_TEXT[icon] || '').trim()
    const image = bestThumb(badge.custom_thumbnail)
    if (image) {
      out.push({ id: icon.toLowerCase() || 'custom', url: image.url, title: title || undefined })
      continue
    }
    const label = BADGE_TEXT[icon] || (title ? title.slice(0, 12) : '')
    if (label) {
      out.push({
        id: icon.toLowerCase() || 'badge',
        url: '',
        title: title || label,
        label
      })
    }
  }
  return out
}

function authorFrom(author: YouTubeAuthorLike | undefined, channelId?: string): ChatAuthor {
  const rawName = typeof author?.name === 'string' ? author.name.trim() : ''
  const displayName = rawName.replace(/^@+/, '').trim() || 'YouTube'
  const badges = mapBadges(author?.badges)
  const isBroadcaster =
    (Boolean(author?.id) && Boolean(channelId) && author?.id === channelId) ||
    badges.some((badge) => badge.id === 'owner')
  return {
    name: displayName.toLowerCase(),
    displayName,
    color: colorFromName(author?.id || displayName),
    userId: typeof author?.id === 'string' && author.id ? author.id : undefined,
    badges,
    isMod: isBroadcaster || badges.some((badge) => badge.id === 'moderator'),
    isBroadcaster
  }
}

function fragmentsFromText(message: any): Fragment[] {
  const runs: any[] = Array.isArray(message?.runs) ? message.runs : []
  if (runs.length === 0) {
    const text = message?.toString?.() ?? ''
    return text ? [{ type: 'text', text }] : []
  }

  const out: Fragment[] = []
  const pushText = (text: string): void => {
    if (!text) return
    const last = out[out.length - 1]
    if (last && last.type === 'text') last.text += text
    else out.push({ type: 'text', text })
  }

  for (const run of runs) {
    if (!run) continue
    const image = bestThumb(run?.emoji?.image)
    if (image) {
      out.push({
        type: 'emote',
        url: image.url,
        alt: String(run.text || run.emoji?.shortcuts?.[0] || '').trim() || 'emoji'
      })
      continue
    }
    pushText(typeof run.text === 'string' ? run.text : '')
  }
  return out
}

function fragmentsToText(fragments: Fragment[]): string {
  return fragments.map((fragment) => (fragment.type === 'text' ? fragment.text : fragment.alt)).join('')
}

function tsOf(item: any): number {
  if (typeof item?.timestamp === 'number' && item.timestamp > 0) return item.timestamp
  const usec = Number(item?.timestamp_usec)
  if (Number.isFinite(usec) && usec > 0) return Math.floor(usec / 1000)
  return Date.now()
}

function baseEvent(
  item: any,
  ctx: YouTubeMapContext,
  kind: ChatEventKind,
  author: ChatAuthor,
  fragments: Fragment[]
): ChatEvent {
  return {
    id: `${ctx.sourceId}:${item?.id || randomUUID()}`,
    platform: 'youtube',
    sourceId: ctx.sourceId,
    channel: ctx.channel,
    kind,
    author,
    fragments,
    ts: tsOf(item),
    text: fragmentsToText(fragments)
  }
}

function textEvent(
  item: any,
  ctx: YouTubeMapContext,
  kind: ChatEventKind,
  text: string,
  author?: ChatAuthor
): ChatEvent {
  const event = baseEvent(
    item,
    ctx,
    kind,
    author ?? authorFrom(undefined, ctx.channelId),
    text ? [{ type: 'text', text }] : []
  )
  event.text = text
  return event
}

function textOf(value: any): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.toString?.() ?? ''
}

function joinText(parts: Array<string | undefined>): string {
  return parts
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

function mapItem(item: any, ctx: YouTubeMapContext): ChatEvent | null {
  const type = item?.type ?? item?.constructor?.name

  switch (type) {
    case 'LiveChatTextMessage':
      return baseEvent(
        item,
        ctx,
        'message',
        authorFrom(item.author, ctx.channelId),
        fragmentsFromText(item.message)
      )

    case 'LiveChatPaidMessage': {
      const event = baseEvent(
        item,
        ctx,
        'cheer',
        authorFrom(item.author, ctx.channelId),
        fragmentsFromText(item.message)
      )
      event.amount = textOf(item.purchase_amount) || undefined
      return event
    }

    case 'LiveChatPaidSticker': {
      const sticker = bestThumb(item.sticker)
      const label = textOf(item.sticker_accessibility_label) || 'стикер'
      const event = baseEvent(
        item,
        ctx,
        'cheer',
        authorFrom(item.author, ctx.channelId),
        sticker ? [{ type: 'emote', url: sticker.url, alt: label }] : [{ type: 'text', text: label }]
      )
      event.amount = textOf(item.purchase_amount) || undefined
      return event
    }

    case 'LiveChatMembershipItem': {
      const primary = textOf(item.header_primary_text)
      const text = joinText([primary, textOf(item.header_subtext), textOf(item.message)])
      // YouTube reports new memberships as "Welcome to …"; renewed ones as "Member for N months".
      const kind: ChatEventKind = /^member for\b/i.test(primary.trim()) ? 'resub' : 'sub'
      return textEvent(item, ctx, kind, text || 'Новый участник', authorFrom(item.author, ctx.channelId))
    }

    case 'LiveChatSponsorshipsGiftRedemptionAnnouncement': {
      const text = textOf(item.message) || 'Подарочная подписка'
      return textEvent(item, ctx, 'gift', text, authorFrom(item.author, ctx.channelId))
    }

    case 'LiveChatSponsorshipsGiftPurchaseAnnouncement': {
      const header = item.header
      const author = authorFrom(
        {
          name: textOf(header?.author_name),
          id: item.author_external_channel_id,
          badges: header?.author_badges
        },
        ctx.channelId
      )
      const text = textOf(header?.primary_text) || 'Подарочные подписки'
      return textEvent(item, ctx, 'gift', text, author)
    }

    case 'LiveChatViewerEngagementMessage': {
      const text = textOf(item.message)
      return text ? textEvent(item, ctx, 'system', text) : null
    }

    case 'LiveChatModeChangeMessage': {
      const text = joinText([textOf(item.text), textOf(item.subtext)])
      return text ? textEvent(item, ctx, 'system', text) : null
    }

    default:
      return null
  }
}

export function mapYouTubeAction(action: any, ctx: YouTubeMapContext): ChatEvent[] {
  const item = action?.item
  if (!item) return []
  const event = mapItem(item, ctx)
  return event ? [event] : []
}

export function mapYouTubeClear(action: any, sourceId: string): ClearPayload | null {
  const type = action?.type ?? action?.constructor?.name
  switch (type) {
    case 'MarkChatItemAsDeletedAction':
    case 'RemoveChatItemAction': {
      const target = action?.target_item_id
      return target ? { sourceId, ids: [`${sourceId}:${target}`] } : null
    }
    case 'MarkChatItemsByAuthorAsDeletedAction':
    case 'RemoveChatItemByAuthorAction': {
      const userId = action?.external_channel_id
      return userId ? { sourceId, userId } : null
    }
    default:
      return null
  }
}
