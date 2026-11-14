import WebSocket from 'ws'
import { parseIrcLine, type IrcMessage } from './parser'

export type IrcState = 'connecting' | 'connected' | 'disconnected'

export interface TwitchIrcHandlers {
  onLine: (msg: IrcMessage, raw: string) => void
  onState: (state: IrcState, detail?: string) => void
}

const URL = 'wss://irc-ws.chat.twitch.tv:443'
const MAX_BACKOFF = 30_000

/**
 * Anonymous read-only Twitch IRC connection over WebSocket.
 * One connection serves every joined channel.
 */
export class TwitchIrc {
  private ws: WebSocket | null = null
  private desired = new Set<string>()
  private joined = new Set<string>()
  private nick = `justinfan${Math.floor(10_000 + Math.random() * 80_000)}`
  private reconnectTimer: NodeJS.Timeout | null = null
  private attempts = 0
  private stopped = false
  private state: IrcState = 'disconnected'

  constructor(private handlers: TwitchIrcHandlers) {}

  connect(): void {
    this.stopped = false
    this.open()
  }

  private open(): void {
    if (this.ws) return
    this.setState('connecting')
    const ws = new WebSocket(URL)
    this.ws = ws

    ws.on('open', () => {
      this.attempts = 0
      this.setState('connected')
      this.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      this.send('PASS SCHMOOPIIE')
      this.send(`NICK ${this.nick}`)
      this.joined.clear()
      this.flushJoins()
    })

    ws.on('message', (data) => {
      const text = data.toString()
      for (const line of text.split('\r\n')) {
        if (!line) continue
        const msg = parseIrcLine(line)
        if (!msg) continue
        this.handle(msg, line)
      }
    })

    ws.on('error', (err) => {
      this.setState('disconnected', err.message)
    })

    ws.on('close', () => {
      this.ws = null
      this.joined.clear()
      this.setState('disconnected')
      this.scheduleReconnect()
    })
  }

  private handle(msg: IrcMessage, raw: string): void {
    if (msg.command === 'PING') {
      this.send('PONG :tmi.twitch.tv')
      return
    }
    if (msg.command === 'RECONNECT') {
      this.hardReconnect()
      return
    }
    if (msg.command === '001') {
      this.flushJoins()
    }
    if (msg.command === 'JOIN') {
      const channel = msg.params[0]?.replace(/^#/, '')
      if (channel) this.joined.add(channel)
    }
    this.handlers.onLine(msg, raw)
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    this.attempts += 1
    const delay = Math.min(MAX_BACKOFF, 1000 * 2 ** Math.min(this.attempts - 1, 5))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.stopped) this.open()
    }, delay)
  }

  private hardReconnect(): void {
    this.joined.clear()
    if (this.ws) {
      const ws = this.ws
      this.ws = null
      try {
        ws.terminate()
      } catch {
        /* ignore */
      }
    }
    this.scheduleReconnect()
  }

  private setState(state: IrcState, detail?: string): void {
    if (this.state === state && !detail) return
    this.state = state
    this.handlers.onState(state, detail)
  }

  private send(line: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(`${line}\r\n`)
  }

  private flushJoins(): void {
    const toJoin = [...this.desired].filter((c) => !this.joined.has(c))
    for (let i = 0; i < toJoin.length; i += 20) {
      const chunk = toJoin.slice(i, i + 20)
      this.send(`JOIN ${chunk.map((c) => `#${c}`).join(',')}`)
    }
  }

  setChannels(channels: string[]): void {
    const next = new Set(channels.map((c) => c.toLowerCase()))
    const toPart = [...this.desired].filter((c) => !next.has(c))
    const toJoin = [...next].filter((c) => !this.desired.has(c))
    this.desired = next

    if (toPart.length > 0) {
      this.send(`PART ${toPart.map((c) => `#${c}`).join(',')}`)
      for (const c of toPart) this.joined.delete(c)
    }
    if (toJoin.length > 0) {
      for (let i = 0; i < toJoin.length; i += 20) {
        const chunk = toJoin.slice(i, i + 20)
        this.send(`JOIN ${chunk.map((c) => `#${c}`).join(',')}`)
      }
    }
  }

  close(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.desired.clear()
    this.joined.clear()
    if (this.ws) {
      const ws = this.ws
      this.ws = null
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
    this.setState('disconnected')
  }
}
