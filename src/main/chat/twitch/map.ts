import { randomUUID } from 'node:crypto'
import type {
  ChatAuthor,
  ChatEvent,
  ChatEventKind,
  ClearPayload,
  EmoteDef
} from '../../../shared/types'
import {
  applyWordEmotes,
  buildFragments,
  colorFromName,
  fragmentsToText,
  parseBadges,
  type IrcMessage
} from './parser'

export interface MapContext {
  sourceId: string
  channel: string
  emotes: Map<string, EmoteDef>
}

function authorFrom(msg: IrcMessage): ChatAuthor {
  const tags = msg.tags
  const login = tags['login'] || msg.prefix?.split('!')[0] || 'unknown'
  const badges = parseBadges(tags['badges'])
  const isBroadcaster = badges.some((b) => b.id === 'broadcaster')
  return {
    name: login.toLowerCase(),
    displayName: tags['display-name'] || login,
    color: tags['color'] || colorFromName(login),
    userId: tags['user-id'] || undefined,
    badges,
    isMod: tags['mod'] === '1' || isBroadcaster,
    isBroadcaster
  }
}

function baseEvent(
  msg: IrcMessage,
  ctx: MapContext,
  kind: ChatEventKind,
  author: ChatAuthor
): ChatEvent {
  return {
    id: `${ctx.sourceId}:${msg.tags['id'] || randomUUID()}`,
    platform: 'twitch',
    sourceId: ctx.sourceId,
    channel: ctx.channel,
    kind,
    author,
    fragments: [],
    ts: Number(msg.tags['tmi-sent-ts']) || Date.now(),
    text: ''
  }
}

export function mapPrivmsg(msg: IrcMessage, ctx: MapContext): ChatEvent | null {
  const raw = msg.params[1]
  if (raw === undefined) return null

  let text = raw
  let kind: ChatEventKind = 'message'
  if (text.startsWith('\u0001ACTION ')) {
    kind = 'action'
    text = text.slice(8).replace(/\u0001$/, '')
  }

  const author = authorFrom(msg)
  const event = baseEvent(msg, ctx, kind, author)
  let fragments = buildFragments(text, msg.tags['emotes'])
  if (ctx.emotes.size > 0) fragments = applyWordEmotes(fragments, ctx.emotes)
  event.fragments = fragments
  event.text = fragmentsToText(fragments)

  const bits = msg.tags['bits']
  if (bits) {
    event.kind = 'cheer'
    event.amount = `${Number(bits).toLocaleString('ru-RU')} bits`
  }

  return event
}

const USERNOTICE_KINDS: Record<string, ChatEventKind> = {
  sub: 'sub',
  resub: 'resub',
  subgift: 'gift',
  submysterygift: 'gift',
  anongiftpaidupgrade: 'gift',
  giftpaidupgrade: 'gift',
  raid: 'raid',
  unraid: 'system',
  rewardgift: 'gift',
  communitypayforward: 'gift',
  primepaidupgrade: 'sub'
}

export function mapUsernotice(msg: IrcMessage, ctx: MapContext): ChatEvent | null {
  const msgId = msg.tags['msg-id'] || 'notice'
  const kind = USERNOTICE_KINDS[msgId] ?? 'system'
  const author = authorFrom(msg)
  if (!author.displayName || author.displayName === 'unknown') {
    author.displayName = msg.tags['msg-param-displayName'] || msg.tags['login'] || 'twitch'
  }
  const event = baseEvent(msg, ctx, kind, author)
  const systemMsg = msg.tags['system-msg'] || ''
  const userText = msg.params[1] || ''
  event.text = userText ? `${systemMsg} ${userText}`.trim() : systemMsg
  event.fragments = [{ type: 'text', text: event.text }]
  return event
}

export function mapClear(msg: IrcMessage, sourceId: string): ClearPayload | null {
  if (msg.command === 'CLEARMSG') {
    const id = msg.tags['target-msg-id']
    if (!id) return null
    return { sourceId, ids: [`${sourceId}:${id}`] }
  }
  if (msg.command === 'CLEARCHAT') {
    const userId = msg.tags['target-user-id']
    if (userId) return { sourceId, userId }
    return { sourceId, all: true }
  }
  return null
}
