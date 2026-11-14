import type { ChatEvent, ClearPayload, SourceConfig } from '../../../shared/types'
import { mapYouTubeAction, mapYouTubeClear } from './map'
import { resolveYouTubeTarget, type LiveTarget } from './resolve'
import { getInnertube } from './runtime'

const OFFLINE_RETRY = 45_000
const ERROR_RETRY = 30_000
const RESTART_DELAY = 5_000

export type YouTubeChatState = 'connecting' | 'connected' | 'offline' | 'error'

export interface YouTubeChatHandlers {
  onEvent: (event: ChatEvent) => void
  onClear: (payload: ClearPayload) => void
  onStatus: (state: YouTubeChatState, detail?: string) => void
}

function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.replace(/\s+/g, ' ').trim().slice(0, 200) || 'неизвестная ошибка'
}

function clip(text: string | undefined, max = 90): string | undefined {
  if (!text) return undefined
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Keeps a YouTube live chat attached to a source. When the stream ends or the
 * channel goes offline it re-resolves the channel and waits for the next live.
 */
export class YouTubeChat {
  private stopped = false
  private loopPromise: Promise<void> | null = null
  private chat: any = null
  private wake: (() => void) | null = null
  private finishCurrent: (() => void) | null = null

  constructor(
    private source: SourceConfig,
    private handlers: YouTubeChatHandlers
  ) {}

  start(): void {
    if (this.loopPromise) return
    this.stopped = false
    this.loopPromise = this.loop().finally(() => {
      this.loopPromise = null
    })
  }

  stop(): void {
    this.stopped = true
    this.finishCurrent?.()
    this.stopChat()
    this.wake?.()
  }

  private stopChat(): void {
    const chat = this.chat
    this.chat = null
    if (!chat) return
    try {
      chat.removeAllListeners?.()
    } catch {
      /* ignore */
    }
    try {
      chat.stop()
    } catch {
      /* ignore */
    }
  }

  private sleep(ms: number): Promise<void> {
    if (this.stopped) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null
        resolve()
      }, ms)
      this.wake = () => {
        clearTimeout(timer)
        this.wake = null
        resolve()
      }
    })
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      this.handlers.onStatus('connecting', 'ищем эфир…')

      let target: Awaited<ReturnType<typeof resolveYouTubeTarget>>
      try {
        target = await resolveYouTubeTarget(this.source.channel)
      } catch (error) {
        if (this.stopped) return
        this.handlers.onStatus('error', errorText(error))
        await this.sleep(ERROR_RETRY)
        continue
      }
      if (this.stopped) return

      if (target.kind === 'offline') {
        this.handlers.onStatus(
          'offline',
          target.channelTitle ? `${target.channelTitle}: не в эфире` : 'канал не в эфире'
        )
        await this.sleep(OFFLINE_RETRY)
        continue
      }

      this.handlers.onStatus(
        'connecting',
        target.title ? `подключаемся: ${clip(target.title)}` : 'подключаемся к эфиру…'
      )

      try {
        await this.runChat(target)
      } catch (error) {
        if (this.stopped) return
        this.handlers.onStatus('error', errorText(error))
        await this.sleep(ERROR_RETRY)
        continue
      }

      if (!this.stopped) {
        this.handlers.onStatus('connecting', 'эфир завершился, ищем следующий…')
        await this.sleep(RESTART_DELAY)
      }
    }
  }

  private async runChat(target: LiveTarget): Promise<void> {
    const yt = await getInnertube()
    if (this.stopped) return

    const info = await yt.getInfo(target.videoId)
    if (this.stopped) return

    if (!info?.basic_info?.is_live) {
      this.handlers.onStatus('offline', 'эфир уже закончился')
      await this.sleep(OFFLINE_RETRY)
      return
    }
    if (!info.livechat) {
      this.handlers.onStatus('error', 'у эфира отключён чат')
      await this.sleep(ERROR_RETRY)
      return
    }

    const channelId = info.basic_info.channel_id ?? target.channelId
    const title = info.basic_info.title ?? target.title
    const context = { sourceId: this.source.id, channel: this.source.channel, channelId }

    const chat = info.getLiveChat()
    this.chat = chat

    let ended: () => void = () => {}
    const done = new Promise<void>((resolve) => {
      ended = resolve
    })
    this.finishCurrent = ended

    chat.on('start', () => {
      if (this.stopped) return
      this.handlers.onStatus('connected', clip(title))
    })

    chat.on('chat-update', (action: any) => {
      if (this.stopped) return
      try {
        const clear = mapYouTubeClear(action, this.source.id)
        if (clear) {
          this.handlers.onClear(clear)
          return
        }
        for (const event of mapYouTubeAction(action, context)) {
          this.handlers.onEvent(event)
        }
      } catch (error) {
        console.error(
          '[youtube] failed to map action',
          action?.type ?? action?.constructor?.name,
          error
        )
      }
    })

    chat.on('error', (error: unknown) => {
      if (this.stopped) return
      this.handlers.onStatus('error', errorText(error))
      ended()
    })

    chat.on('end', () => {
      if (this.stopped) return
      ended()
    })

    try {
      chat.start()
    } catch (error) {
      this.stopChat()
      throw error
    }

    await done
    this.finishCurrent = null
    this.stopChat()
  }
}
