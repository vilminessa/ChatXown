import { useEffect, useRef, useState } from 'react'
import type {
  AppConfig,
  AuthStatus,
  ChatEvent,
  ModAction,
  ScreenRect,
  SourceStatus
} from '../../../shared/types'
import { anchorRect, clampRect, snap, type Anchor } from '../../../shared/layout'
import { Feed } from './Feed'

const api = window.chatxown

export type DragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

const HANDLES: Array<{ mode: DragMode; className: string }> = [
  { mode: 'n', className: 'rz rz-n' },
  { mode: 's', className: 'rz rz-s' },
  { mode: 'e', className: 'rz rz-e' },
  { mode: 'w', className: 'rz rz-w' },
  { mode: 'nw', className: 'rz rz-nw' },
  { mode: 'ne', className: 'rz rz-ne' },
  { mode: 'sw', className: 'rz rz-sw' },
  { mode: 'se', className: 'rz rz-se' }
]

const ANCHORS: Array<{ anchor: Anchor; glyph: string; title: string }> = [
  { anchor: 'tl', glyph: '⌜', title: 'К левому верхнему углу' },
  { anchor: 'tr', glyph: '⌝', title: 'К правому верхнему углу' },
  { anchor: 'bl', glyph: '⌞', title: 'К левому нижнему углу' },
  { anchor: 'br', glyph: '⌟', title: 'К правому нижнему углу' }
]

const TOOLBAR_H = 30

interface ChatAreaProps {
  rect: ScreenRect
  view: { width: number; height: number }
  /** Pointer sits over ChatXown UI, or click-through is off. */
  interactive: boolean
  config: AppConfig
  events: ChatEvent[]
  accentById: Map<string, string>
  canModerate: boolean
  selfUserId?: string
  onModerate: (event: ChatEvent, action: ModAction) => void
  statuses: SourceStatus[]
  auth: AuthStatus | null
  onDragStart: (mode: DragMode) => void
  onDragEnd: () => void
  /** Live rect while dragging. */
  onRect: (rect: ScreenRect) => void
  /** Pointer released: persist the rect. */
  onCommit: () => void
  /** Set the chat area to null (fills the overlay). */
  onFullscreen: () => void
  onOpenPanel: () => void
}

export function ChatArea({
  rect,
  view,
  interactive,
  config,
  events,
  accentById,
  canModerate,
  selfUserId,
  onModerate,
  statuses,
  auth,
  onDragStart,
  onDragEnd,
  onRect,
  onCommit,
  onFullscreen,
  onOpenPanel
}: ChatAreaProps): React.JSX.Element {
  const drag = useRef<{ mode: DragMode; base: ScreenRect; startX: number; startY: number } | null>(
    null
  )
  const [dragMode, setDragMode] = useState<DragMode | null>(null)

  const beginDrag = (mode: DragMode, event: React.PointerEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    drag.current = { mode, base: rect, startX: event.clientX, startY: event.clientY }
    setDragMode(mode)
    onDragStart(mode)
  }

  useEffect(() => {
    if (!dragMode) return

    const onMove = (event: PointerEvent): void => {
      const current = drag.current
      if (!current) return
      const dx = event.clientX - current.startX
      const dy = event.clientY - current.startY
      let x = current.base.x
      let y = current.base.y
      let width = current.base.width
      let height = current.base.height

      if (current.mode === 'move') {
        x += dx
        y += dy
      } else {
        if (current.mode.includes('w')) {
          x += dx
          width -= dx
        }
        if (current.mode.includes('e')) width += dx
        if (current.mode.includes('n')) {
          y += dy
          height -= dy
        }
        if (current.mode.includes('s')) height += dy
      }

      const next = clampRect({ x, y, width, height }, view)
      next.x = snap(next.x, view.width - next.width)
      next.y = snap(next.y, view.height - next.height)
      onRect(next)
    }

    const onUp = (): void => {
      drag.current = null
      setDragMode(null)
      onDragEnd()
      onCommit()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragMode, view, onRect, onDragEnd, onCommit])

  // The layout toolbar hugs the chat area: below it, above it, or inside when the area is at the top.
  const TOOLBAR_W = 230
  const below = rect.y + rect.height + TOOLBAR_H + 8 <= view.height
  const above = rect.y >= TOOLBAR_H + 40
  const toolbarY = below ? rect.y + rect.height + 4 : above ? rect.y - TOOLBAR_H - 4 : rect.y + 36
  const toolbarX = Math.max(
    4,
    Math.min(below || above ? rect.x : rect.x + rect.width - TOOLBAR_W, view.width - TOOLBAR_W)
  )

  return (
    <>
      <div
        className={`chat ${interactive ? 'chat-active' : ''}`}
        data-interactive=""
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      >
        <div className="chat-head" onPointerDown={(event) => beginDrag('move', event)}>
          <span className="chat-title">ChatXown</span>
          <span className="chat-status">
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
          <div className="chat-actions" onPointerDown={(event) => event.stopPropagation()}>
            <button title="Настройки (Ctrl+Alt+S)" onClick={onOpenPanel}>
              ⚙
            </button>
            <button title="Скрыть оверлей (Ctrl+Alt+H)" onClick={() => void api.overlayAction('hide')}>
              ✕
            </button>
          </div>
        </div>

        <Feed
          events={events}
          config={config}
          accentById={accentById}
          canModerate={canModerate}
          selfUserId={selfUserId}
          onModerate={onModerate}
        />

        {interactive &&
          HANDLES.map((handle) => (
            <div
              key={handle.mode}
              className={handle.className}
              onPointerDown={(event) => beginDrag(handle.mode, event)}
            />
          ))}
      </div>

      {interactive && (
        <div
          className="chat-toolbar"
          data-interactive=""
          style={{ left: toolbarX, top: toolbarY, height: TOOLBAR_H }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button title="Чат на весь экран" onClick={onFullscreen}>
            ▣
          </button>
          {ANCHORS.map((anchor) => (
            <button
              key={anchor.anchor}
              title={anchor.title}
              onClick={() => {
                onRect(anchorRect(rect, anchor.anchor, view))
                onCommit()
              }}
            >
              {anchor.glyph}
            </button>
          ))}
          <span className="chat-size">
            {rect.width}×{rect.height}
          </span>
          <button
            className={config.overlay.clickThrough ? '' : 'on'}
            title="Сквозной режим: клики проходят в приложение под оверлеем (Ctrl+Alt+O)"
            onClick={() => void api.overlayAction('toggle-click-through')}
          >
            ⤢
          </button>
        </div>
      )}
    </>
  )
}
