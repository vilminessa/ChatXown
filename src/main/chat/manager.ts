import type {
  ChatEvent,
  ClearPayload,
  EmoteDef,
  SourceConfig,
  SourceStatus
} from '../../shared/types'
import { loadEmotes } from './emotes'
import { TwitchIrc, type IrcState } from './twitch/client'
import { mapClear, mapPrivmsg, mapUsernotice, type MapContext } from './twitch/map'
import type { IrcMessage } from './twitch/parser'
import { YouTubeChat, type YouTubeChatState } from './youtube/client'

export interface ChatManagerHandlers {
  onEvent: (event: ChatEvent) => void
  onClear: (payload: ClearPayload) => void
  onStatus: (statuses: SourceStatus[]) => void
}

interface EmoteSlot {
  roomId: string
  signature: string
  set: Map<string, EmoteDef>
}

const EMPTY_EMOTES: Map<string, EmoteDef> = new Map()

export class ChatManager {
  private irc: TwitchIrc
  private sources = new Map<string, SourceConfig>()
  private twitchSources = new Map<string, SourceConfig>()
  private byChannel = new Map<string, SourceConfig>()
  private youtubeClients = new Map<string, YouTubeChat>()
  private youtubeChannels = new Map<string, string>()
  private statuses = new Map<string, SourceStatus>()
  private emotes = new Map<string, EmoteSlot>()
  private loading = new Set<string>()
  private roomIds = new Map<string, string>()
  private lastError: string | undefined

  constructor(private handlers: ChatManagerHandlers) {
    this.irc = new TwitchIrc({
      onLine: (msg) => this.handleLine(msg),
      onState: (state, detail) => this.handleState(state, detail)
    })
    this.irc.connect()
  }

  /* ------------------------------ sources ------------------------------ */

  setSources(sources: SourceConfig[]): void {
    this.sources = new Map(sources.map((source) => [source.id, source]))

    this.twitchSources.clear()
    this.byChannel.clear()
    for (const source of sources) {
      if (source.platform !== 'twitch') continue
      this.twitchSources.set(source.id, source)
      this.byChannel.set(source.channel, source)
    }

    for (const id of [...this.statuses.keys()]) {
      if (!this.sources.has(id)) this.statuses.delete(id)
    }
    for (const source of sources) {
      const previous = this.statuses.get(source.id)
      if (!previous) {
        this.statuses.set(source.id, {
          id: source.id,
          channel: source.channel,
          state: source.enabled ? 'connecting' : 'idle'
        })
      } else {
        const state = !source.enabled
          ? 'idle'
          : previous.state === 'idle'
            ? 'connecting'
            : previous.state
        this.setStatus(source.id, {
          channel: source.channel,
          state,
          detail: source.enabled ? previous.detail : undefined
        })
      }
    }

    this.irc.setChannels(
      [...this.twitchSources.values()].filter((source) => source.enabled).map((source) => source.channel)
    )

    for (const source of this.twitchSources.values()) {
      const roomId = this.roomIds.get(source.channel)
      if (roomId) this.ensureEmotes(source, roomId)
    }

    this.syncYouTube(sources)
    this.broadcast()
  }

  private syncYouTube(sources: SourceConfig[]): void {
    for (const [id, client] of [...this.youtubeClients]) {
      const source = this.sources.get(id)
      const channel = this.youtubeChannels.get(id)
      if (!source || source.platform !== 'youtube' || !source.enabled || source.channel !== channel) {
        client.stop()
        this.youtubeClients.delete(id)
        this.youtubeChannels.delete(id)
        if (source && (!source.enabled || source.platform !== 'youtube')) {
          this.setStatus(id, { state: 'idle', detail: undefined, channel: source.channel })
        }
      }
    }

    for (const source of sources) {
      if (source.platform !== 'youtube' || !source.enabled) continue
      if (this.youtubeClients.has(source.id)) continue

      const client = new YouTubeChat(source, {
        onEvent: (event) => this.handleYouTubeEvent(source.id, event),
        onClear: (payload) => this.handlers.onClear(payload),
        onStatus: (state, detail) => this.handleYouTubeStatus(source.id, state, detail)
      })
      this.youtubeClients.set(source.id, client)
      this.youtubeChannels.set(source.id, source.channel)
      client.start()
    }
  }

  private handleYouTubeEvent(sourceId: string, event: ChatEvent): void {
    const source = this.sources.get(sourceId)
    if (!source || !source.enabled) return
    if (!this.passesFilter(source, event)) return
    this.handlers.onEvent(event)
  }

  private handleYouTubeStatus(sourceId: string, state: YouTubeChatState, detail?: string): void {
    const source = this.sources.get(sourceId)
    if (!source || !source.enabled) {
      this.setStatus(sourceId, { state: 'idle', detail: undefined })
      return
    }
    this.setStatus(sourceId, { state, detail, channel: source.channel })
  }

  private status(sourceId: string): SourceStatus | undefined {
    return this.statuses.get(sourceId)
  }

  private setStatus(sourceId: string, patch: Partial<SourceStatus>): void {
    const previous = this.statuses.get(sourceId)
    if (!previous) return
    const next = { ...previous, ...patch }
    if (
      previous.state === next.state &&
      previous.detail === next.detail &&
      previous.channel === next.channel
    ) {
      return
    }
    this.statuses.set(sourceId, next)
    this.broadcast()
  }

  private broadcast(): void {
    this.handlers.onStatus([...this.statuses.values()])
  }

  private handleState(state: IrcState, detail?: string): void {
    this.lastError = detail
    for (const source of this.twitchSources.values()) {
      if (!source.enabled) {
        this.setStatus(source.id, { state: 'idle' })
        continue
      }
      if (state === 'connected') {
        this.setStatus(source.id, { state: 'connecting', detail: undefined })
      } else if (state === 'connecting') {
        this.setStatus(source.id, { state: 'connecting', detail })
      } else {
        this.setStatus(source.id, { state: 'error', detail: detail ?? 'нет соединения' })
      }
    }
  }

  /* ------------------------------- emotes ------------------------------ */

  private ensureEmotes(source: SourceConfig, roomId: string): void {
    const signature = `${Number(source.emotes.bttv)}${Number(source.emotes.ffz)}${Number(source.emotes.sevenTv)}`
    const current = this.emotes.get(source.channel)
    if (current && current.roomId === roomId && current.signature === signature) return
    const key = `${source.channel}:${signature}`
    if (this.loading.has(key)) return
    if (
      signature === '000' ||
      (!source.emotes.bttv && !source.emotes.ffz && !source.emotes.sevenTv)
    ) {
      this.emotes.set(source.channel, { roomId, signature, set: EMPTY_EMOTES })
      return
    }

    this.loading.add(key)
    void loadEmotes(roomId, source.emotes)
      .then((set) => {
        this.emotes.set(source.channel, { roomId, signature, set })
      })
      .finally(() => this.loading.delete(key))
  }

  private emoteSet(channel: string): Map<string, EmoteDef> {
    return this.emotes.get(channel)?.set ?? EMPTY_EMOTES
  }

  /* ------------------------------- parsing ----------------------------- */

  private handleLine(msg: IrcMessage): void {
    try {
      switch (msg.command) {
        case 'PRIVMSG':
          this.onPrivmsg(msg)
          break
        case 'USERNOTICE':
          this.onUsernotice(msg)
          break
        case 'CLEARMSG':
        case 'CLEARCHAT': {
          const channel = msg.params[0]?.replace(/^#/, '')
          const source = channel ? this.byChannel.get(channel) : undefined
          if (!source) return
          const payload = mapClear(msg, source.id)
          if (payload) this.handlers.onClear(payload)
          break
        }
        case 'ROOMSTATE':
          this.onRoomState(msg)
          break
        case 'NOTICE':
          this.onNotice(msg)
          break
        default:
          break
      }
    } catch (error) {
      console.error('[chat] failed to handle line', msg.command, error)
    }
  }

  private onRoomState(msg: IrcMessage): void {
    const channel = msg.params[0]?.replace(/^#/, '')
    if (!channel) return
    const source = this.byChannel.get(channel)
    const roomId = msg.tags['room-id']
    if (roomId) {
      this.roomIds.set(channel, roomId)
      if (source) this.ensureEmotes(source, roomId)
    }
    if (source && source.enabled) {
      this.setStatus(source.id, { state: 'connected', detail: undefined })
    }
  }

  private onNotice(msg: IrcMessage): void {
    const channel = msg.params[0]?.replace(/^#/, '')
    const text = msg.params[1] ?? ''
    if (!channel) return
    const source = this.byChannel.get(channel)
    if (!source) return
    if (/suspended|banned|not found|unavailable/i.test(text)) {
      this.setStatus(source.id, { state: 'error', detail: text })
    }
  }

  private context(source: SourceConfig): MapContext {
    return {
      sourceId: source.id,
      channel: source.channel,
      emotes: this.emoteSet(source.channel)
    }
  }

  private onPrivmsg(msg: IrcMessage): void {
    const channel = msg.params[0]?.replace(/^#/, '')
    if (!channel) return
    const source = this.byChannel.get(channel)
    if (!source || !source.enabled) return
    const roomId = msg.tags['room-id']
    if (roomId && this.roomIds.get(channel) !== roomId) {
      this.roomIds.set(channel, roomId)
      this.ensureEmotes(source, roomId)
    }
    if (this.status(source.id)?.state !== 'connected') {
      // A message is proof enough that the channel is joined.
      this.setStatus(source.id, { state: 'connected', detail: undefined })
    }
    const event = mapPrivmsg(msg, this.context(source))
    if (!event) return
    if (!this.passesFilter(source, event)) return
    this.handlers.onEvent(event)
  }

  private onUsernotice(msg: IrcMessage): void {
    const channel = msg.params[0]?.replace(/^#/, '')
    if (!channel) return
    const source = this.byChannel.get(channel)
    if (!source || !source.enabled) return
    const event = mapUsernotice(msg, this.context(source))
    if (event) this.handlers.onEvent(event)
  }

  private passesFilter(source: SourceConfig, event: ChatEvent): boolean {
    const hideUsers = source.filter.hideUsers
    if (hideUsers.length > 0) {
      const name = event.author.name.toLowerCase()
      if (hideUsers.some((u) => u.trim().toLowerCase() === name)) return false
    }
    const hideWords = source.filter.hideWords
    if (hideWords.length > 0) {
      const text = event.text.toLowerCase()
      if (hideWords.some((w) => w.trim() && text.includes(w.trim().toLowerCase()))) return false
    }
    return true
  }

  stop(): void {
    this.irc.close()
    for (const client of this.youtubeClients.values()) client.stop()
    this.youtubeClients.clear()
    this.youtubeChannels.clear()
  }

  getStatuses(): SourceStatus[] {
    return [...this.statuses.values()]
  }
}
