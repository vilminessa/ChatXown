import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppConfig,
  AuthStatus,
  ChatEvent,
  ClearPayload,
  ModAction,
  SourceStatus
} from '../../../shared/types'
import { Feed } from './Feed'

const api = window.chatxown

interface Toast {
  id: number
  text: string
  kind: 'ok' | 'error'
}

const ACTION_RESULT: Record<ModAction, string> = {
  delete: 'Сообщение удалено',
  timeout: 'Таймаут 10 минут',
  ban: 'Пользователь забанен',
  unban: 'Пользователь разбанен'
}

export function App(): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [statuses, setStatuses] = useState<SourceStatus[]>([])
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [events, setEvents] = useState<ChatEvent[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])

  const configRef = useRef<AppConfig | null>(null)
  const pending = useRef<ChatEvent[]>([])
  const frame = useRef<number | null>(null)
  const toastId = useRef(0)

  const notify = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    toastId.current += 1
    const id = toastId.current
    setToasts((prev) => [...prev.slice(-2), { id, text, kind }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 4000)
  }, [])

  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => {
    void api.getState().then((state) => {
      setConfig(state.config)
      configRef.current = state.config
      setStatuses(state.statuses)
      setAuth(state.auth)
    })

    const offEvent = api.onEvent((event) => {
      pending.current.push(event)
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        const batch = pending.current
        pending.current = []
        if (batch.length === 0) return
        setEvents((prev) => {
          const seen = new Set(prev.map((e) => e.id))
          const fresh = batch.filter((e) => !seen.has(e.id))
          if (fresh.length === 0) return prev
          const max = configRef.current?.appearance.maxMessages ?? 150
          const next = prev.concat(fresh)
          return next.length > max ? next.slice(next.length - max) : next
        })
      })
    })

    const offClear = api.onClear((payload: ClearPayload) => {
      pending.current = []
      setEvents((prev) =>
        prev.filter((event) => {
          if (event.sourceId !== payload.sourceId) return true
          if (payload.all) return false
          if (payload.ids?.includes(event.id)) return false
          if (payload.userId && event.author.userId === payload.userId) return false
          return true
        })
      )
    })

    const offStatus = api.onStatus((next) => setStatuses(next))
    const offConfig = api.onConfig((next) => {
      setConfig(next)
      configRef.current = next
    })
    const offAuth = api.onAuthChanged((next) => setAuth(next))

    return () => {
      offEvent()
      offClear()
      offStatus()
      offConfig()
      offAuth()
    }
  }, [])

  // Drop messages older than the configured lifetime.
  useEffect(() => {
    const hideAfter = config?.appearance.hideAfterMs ?? 0
    if (hideAfter <= 0) return
    const timer = setInterval(() => {
      const cutoff = Date.now() - hideAfter
      setEvents((prev) => (prev.some((e) => e.ts < cutoff) ? prev.filter((e) => e.ts >= cutoff) : prev))
    }, 2000)
    return () => clearInterval(timer)
  }, [config?.appearance.hideAfterMs])

  const accentById = useMemo(() => {
    const map = new Map<string, string>()
    for (const source of config?.sources ?? []) map.set(source.id, source.accent)
    return map
  }, [config?.sources])

  const moderate = useCallback(
    async (event: ChatEvent, action: ModAction) => {
      const result = await api.moderate({
        sourceId: event.sourceId,
        action,
        messageId: action === 'delete' ? event.id : undefined,
        userId: event.author.userId,
        userName: event.author.name,
        duration: action === 'timeout' ? 600 : undefined
      })
      notify(result.ok ? ACTION_RESULT[action] : (result.error ?? 'Не удалось выполнить действие'), result.ok ? 'ok' : 'error')
    },
    [notify]
  )

  if (!config) return <div className="loading">ChatXown</div>

  const interactive = !config.overlay.clickThrough
  const canModerate = interactive && Boolean(auth?.loggedIn)

  return (
    <div
      className="root"
      style={{
        ['--font-size' as string]: `${config.appearance.fontSize}px`,
        ['--max-width' as string]: `${config.appearance.maxBubbleWidth}px`
      }}
    >
      {interactive && (
        <header className="chrome">
          <div className="chrome-drag">
            <span className="chrome-title">ChatXown</span>
            <span className="chrome-status">
              {statuses.map((status) => (
                <span
                  key={status.id}
                  className={`dot dot-${status.state}`}
                  title={`${status.channel}: ${status.detail ?? status.state}`}
                />
              ))}
              {auth?.loggedIn && (
                <span className="auth-chip" title={`Twitch: ${auth.login ?? ''}`}>
                  @{auth.login}
                </span>
              )}
            </span>
          </div>
          <div className="chrome-actions">
            <button title="Сквозной режим (Ctrl+Alt+O)" onClick={() => void api.overlayAction('toggle-click-through')}>
              ⤢
            </button>
            <button title="Настройки (Ctrl+Alt+S)" onClick={() => void api.openSettings()}>
              ⚙
            </button>
            <button title="Скрыть (Ctrl+Alt+H)" onClick={() => void api.overlayAction('hide')}>
              ✕
            </button>
          </div>
        </header>
      )}
      <Feed
        events={events}
        config={config}
        accentById={accentById}
        canModerate={canModerate}
        selfUserId={auth?.userId}
        onModerate={moderate}
      />
      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  )
}
