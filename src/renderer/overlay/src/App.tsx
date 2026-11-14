import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppConfig, ChatEvent, ClearPayload, SourceStatus } from '../../../shared/types'
import { Feed } from './Feed'

const api = window.chatxown

export function App(): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [statuses, setStatuses] = useState<SourceStatus[]>([])
  const [events, setEvents] = useState<ChatEvent[]>([])

  const configRef = useRef<AppConfig | null>(null)
  const pending = useRef<ChatEvent[]>([])
  const frame = useRef<number | null>(null)

  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => {
    void api.getState().then((state) => {
      setConfig(state.config)
      configRef.current = state.config
      setStatuses(state.statuses)
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

    return () => {
      offEvent()
      offClear()
      offStatus()
      offConfig()
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

  if (!config) return <div className="loading">ChatXown</div>

  return (
    <div
      className="root"
      style={{
        ['--font-size' as string]: `${config.appearance.fontSize}px`,
        ['--max-width' as string]: `${config.appearance.maxBubbleWidth}px`
      }}
    >
      {!config.overlay.clickThrough && (
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
      <Feed events={events} config={config} accentById={accentById} />
    </div>
  )
}
