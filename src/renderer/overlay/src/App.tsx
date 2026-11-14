import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppConfig,
  AuthStatus,
  ChatEvent,
  ClearPayload,
  ModAction,
  ScreenRect,
  SourceStatus
} from '../../../shared/types'
import { clampRect, fullRect, sameRect } from '../../../shared/layout'
import { ChatArea, type DragMode } from './ChatArea'
import { Feed } from './Feed'
import { Panel } from './Panel'

const api = window.chatxown

interface Toast {
  id: number
  text: string
  kind: 'ok' | 'error'
}

interface Viewport {
  width: number
  height: number
}

const ACTION_RESULT: Record<ModAction, string> = {
  delete: 'Сообщение удалено',
  timeout: 'Таймаут 10 минут',
  ban: 'Пользователь забанен',
  unban: 'Пользователь разбанен'
}

/** Margin around the chat area that still counts as pointer-over-ChatXown. */
const HOVER_PAD = 12
/** Capture is kept this long after the pointer leaves the zone, so drags do not flicker. */
const HOVER_GRACE_MS = 500

export function App(): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [statuses, setStatuses] = useState<SourceStatus[]>([])
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [events, setEvents] = useState<ChatEvent[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)
  const [draft, setDraft] = useState<ScreenRect | null>(null)
  const [view, setView] = useState<Viewport>({
    width: window.innerWidth,
    height: window.innerHeight
  })

  const configRef = useRef<AppConfig | null>(null)
  const pending = useRef<ChatEvent[]>([])
  const frame = useRef<number | null>(null)
  const toastId = useRef(0)
  const reported = useRef({ interactive: false, focus: false })
  const rectRef = useRef<ScreenRect>(fullRect(view))
  const viewRef = useRef<Viewport>(view)
  const panelRef = useRef(false)
  const dragRef = useRef(false)
  const hoverRef = useRef(false)
  const lastInside = useRef(0)
  // Impossible coordinate: "no pointer yet" must never count as inside a padded zone.
  const pointer = useRef({ x: -10_000, y: -10_000 })
  const visibleRef = useRef(true)

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

  /** Hide/show resets every pointer-dependent state, so the next move re-claims capture. */
  const syncVisibility = useCallback((visible: boolean) => {
    if (visible === visibleRef.current) return
    visibleRef.current = visible
    if (visible) return
    setPanelOpen(false)
    setDragging(false)
    hoverRef.current = false
    lastInside.current = 0
    pointer.current = { x: -10_000, y: -10_000 }
    setHover(false)
    reported.current = { interactive: false, focus: false }
  }, [])

  useEffect(() => {
    void api.getState().then((state) => {
      setConfig(state.config)
      configRef.current = state.config
      setStatuses(state.statuses)
      setAuth(state.auth)
      visibleRef.current = state.config.overlay.visible
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
      syncVisibility(next.overlay.visible)
    })
    const offAuth = api.onAuthChanged((next) => setAuth(next))
    const offPanel = api.onPanelToggle(() => setPanelOpen((open) => !open))
    const offCapture = api.onCapture(({ clickThrough }) => {
      notify(
        clickThrough
          ? 'Сквозной режим включён — клики проходят под оверлей'
          : 'Сквозной режим выключен — оверлей держит весь экран',
        clickThrough ? 'ok' : 'error'
      )
    })

    return () => {
      offEvent()
      offClear()
      offStatus()
      offConfig()
      offAuth()
      offPanel()
      offCapture()
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

  useEffect(() => {
    const onResize = (): void =>
      setView({ width: window.innerWidth, height: window.innerHeight })
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const rect = useMemo<ScreenRect>(() => {
    if (draft) return clampRect(draft, view)
    const saved = config?.overlay.chat
    return saved ? clampRect(saved, view) : fullRect(view)
  }, [draft, config?.overlay.chat, view])

  useEffect(() => {
    rectRef.current = rect
  }, [rect])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    panelRef.current = panelOpen
    dragRef.current = dragging
    if (panelOpen || dragging) {
      lastInside.current = Date.now()
      hoverRef.current = true
      setHover(true)
    }
  }, [panelOpen, dragging])

  const commit = useCallback((rect?: ScreenRect) => {
    const next = clampRect(rect ?? rectRef.current, viewRef.current)
    rectRef.current = next
    setDraft(null)
    void api.setChat(next).then((nextConfig) => {
      setConfig(nextConfig)
      configRef.current = nextConfig
    })
  }, [])

  const dragStart = useCallback((_mode: DragMode) => setDragging(true), [])
  const dragEnd = useCallback(() => setDragging(false), [])

  // The display shrank or scaling changed: re-clamp and save the chat area.
  useEffect(() => {
    if (!config || dragging || !config.overlay.chat || sameRect(config.overlay.chat, rect)) return
    const timer = setTimeout(() => commit(), 600)
    return () => clearTimeout(timer)
  }, [rect, config, dragging, commit])

  // Capture mouse (and keyboard while the panel is open) only over ChatXown's own UI.
  useEffect(() => {
    const visible = config?.overlay.visible ?? true
    const interactive = visible && (panelOpen || dragging || hover)
    const focus = visible && panelOpen
    if (reported.current.interactive === interactive && reported.current.focus === focus) return
    reported.current = { interactive, focus }
    api.setInteractive({ interactive, focus })
  }, [panelOpen, dragging, hover, config?.overlay.visible])

  // Diagnostics for the UI probe: which condition keeps the capture.
  useEffect(() => {
    document.body.dataset.ui = JSON.stringify({
      hover,
      dragging,
      panelOpen,
      visible: config?.overlay.visible ?? true,
      reported: reported.current
    })
  }, [hover, dragging, panelOpen, config?.overlay.visible])

  /** Zones are geometric (chat rect + padding), not DOM targets: gaps cannot break the grab. */
  const evaluateHover = useCallback(() => {
    if (!visibleRef.current) {
      hoverRef.current = false
      setHover(false)
      return
    }
    const point = pointer.current
    const inside =
      panelRef.current ||
      dragRef.current ||
      (point.x >= rectRef.current.x - HOVER_PAD &&
        point.y >= rectRef.current.y - HOVER_PAD &&
        point.x <= rectRef.current.x + rectRef.current.width + HOVER_PAD &&
        point.y <= rectRef.current.y + rectRef.current.height + HOVER_PAD)

    if (inside) {
      lastInside.current = Date.now()
      if (!hoverRef.current) {
        hoverRef.current = true
        setHover(true)
      }
      return
    }
    if (hoverRef.current && Date.now() - lastInside.current >= HOVER_GRACE_MS) {
      hoverRef.current = false
      setHover(false)
    }
  }, [])

  // Pointer over the transparent background must not capture input.
  useEffect(() => {
    const onMove = (event: MouseEvent): void => {
      pointer.current = { x: event.clientX, y: event.clientY }
      evaluateHover()
    }
    const onBlur = (): void => {
      lastInside.current = 0
      evaluateHover()
    }
    document.addEventListener('mousemove', onMove)
    window.addEventListener('blur', onBlur)
    // A pointer that stops moving outside the zone must still release the capture.
    const timer = setInterval(evaluateHover, 250)
    return () => {
      document.removeEventListener('mousemove', onMove)
      window.removeEventListener('blur', onBlur)
      clearInterval(timer)
    }
  }, [evaluateHover])

  useEffect(() => {
    if (!panelOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPanelOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen])

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
      notify(
        result.ok ? ACTION_RESULT[action] : (result.error ?? 'Не удалось выполнить действие'),
        result.ok ? 'ok' : 'error'
      )
    },
    [notify]
  )

  const patch = useCallback((next: unknown) => {
    void api.patchConfig(next).then((result) => {
      setConfig(result)
      configRef.current = result
    })
  }, [])

  if (!config) return <div className="loading">ChatXown</div>

  const interactive = panelOpen || dragging || hover || !config.overlay.clickThrough

  return (
    <div
      className="stage"
      style={{
        ['--font-size' as string]: `${config.appearance.fontSize}px`,
        ['--max-width' as string]: `${config.appearance.maxBubbleWidth}px`
      }}
    >
      <ChatArea
        rect={rect}
        view={view}
        interactive={interactive}
        config={config}
        events={events}
        accentById={accentById}
        canModerate={Boolean(auth?.loggedIn)}
        selfUserId={auth?.userId}
        onModerate={moderate}
        statuses={statuses}
        auth={auth}
        onDragStart={dragStart}
        onDragEnd={dragEnd}
        onRect={setDraft}
        onCommit={commit}
        onFullscreen={() => {
          setDraft(null)
          void api.setChat(null).then((next) => {
            setConfig(next)
            configRef.current = next
          })
        }}
        onOpenPanel={() => setPanelOpen(true)}
      />

      {panelOpen && (
        <Panel
          config={config}
          statuses={statuses}
          auth={auth}
          patch={patch}
          onClose={() => setPanelOpen(false)}
          notify={notify}
        />
      )}

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
