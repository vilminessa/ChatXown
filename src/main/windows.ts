import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { InteractiveState, OverlayAction, ScreenRect } from '../shared/types'
import { store } from './store'

let overlay: BrowserWindow | null = null
let quitting = false
/** Last state requested by the renderer; replayed when config or displays change. */
let lastInteractive: InteractiveState = { interactive: false, focus: false }
let appliedInteractive = false
let appliedFocus = false
let pollTimer: NodeJS.Timeout | null = null

/** Extra margin around the chat area that still counts as "pointer over ChatXown". */
const HOVER_PAD = 12
/** Cursor polling interval (ms) for the main-side fallback. */
const POLL_MS = 120

const debug = (): boolean => Boolean(process.env['CHATXOWN_DEBUG'])

const RENDERER_URL = process.env['ELECTRON_RENDERER_URL']
const PRELOAD = (): string => join(__dirname, '../preload/index.js')

export function resourcePath(file: string): string {
  return join(process.env['ELECTRON_RENDERER_URL'] ? process.cwd() : process.resourcesPath, 'resources', file)
}

function loadRenderer(win: BrowserWindow): void {
  if (RENDERER_URL) {
    void win.loadURL(`${RENDERER_URL}/overlay/index.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/overlay/index.html'))
  }
}

/** Work area of the primary display — the overlay window always covers it. */
function workArea(): { x: number; y: number; width: number; height: number } {
  return screen.getPrimaryDisplay().workArea
}

export function getOverlay(): BrowserWindow | null {
  return overlay
}

export function broadcast(channel: string, payload?: unknown): void {
  if (!overlay || overlay.isDestroyed()) return
  overlay.webContents.send(channel, payload)
}

/**
 * Apply the mouse/focus state. `force` skips the deduplication and flips the opposite
 * style first: Windows keeps `WS_EX_TRANSPARENT` sticky, so a plain re-apply after
 * hide -> show leaves the window deaf to clicks even though it looks unchanged.
 */
function applyInteractive(state: InteractiveState, options: { force?: boolean } = {}): void {
  if (!overlay || overlay.isDestroyed()) return

  // A hidden window must never capture input: ignore renderer reports that arrive after hide,
  // and remember nothing, so the next show starts from a clean click-through state.
  if (!overlay.isVisible()) {
    lastInteractive = { interactive: false, focus: false }
    appliedInteractive = false
    appliedFocus = false
    overlay.setIgnoreMouseEvents(true, { forward: true })
    if (overlay.isFocused()) overlay.blur()
    overlay.setFocusable(false)
    if (debug()) console.log('[interactive] hidden: capture released')
    return
  }

  lastInteractive = state
  // Click-through off means the whole screen captures input, regardless of the pointer.
  const interactive = state.interactive || !store.get().overlay.clickThrough
  const focus = interactive && state.focus
  if (!options.force && interactive === appliedInteractive && focus === appliedFocus) return

  appliedInteractive = interactive
  appliedFocus = focus

  if (debug()) {
    console.log(
      `[interactive] ignore=${!interactive} focusable=${focus} force=${Boolean(options.force)} ` +
        `visible=${overlay.isVisible()} cursor=${store.get().overlay.pollCursor ? 'poll' : 'forward'}`
    )
  }

  if (options.force) overlay.setIgnoreMouseEvents(interactive, { forward: !interactive })
  overlay.setIgnoreMouseEvents(!interactive, { forward: true })

  if (focus) {
    overlay.setFocusable(true)
    overlay.focus()
  } else {
    if (overlay.isFocused()) overlay.blur()
    overlay.setFocusable(false)
  }
}

/** Renderer tells main which UI zone the pointer is over. */
export function setInteractive(state: InteractiveState): void {
  applyInteractive(state ?? { interactive: false, focus: false })
}

/** Point in window-local DIP coordinates; zones match the renderer's geometry. */
function insideZone(point: { x: number; y: number }): boolean {
  const area = workArea()
  // The settings modal covers the whole window, so anywhere inside it is interactive.
  if (lastInteractive.focus) {
    return point.x >= 0 && point.y >= 0 && point.x <= area.width && point.y <= area.height
  }
  const chat = store.get().overlay.chat
  const rect: ScreenRect = chat ?? { x: 0, y: 0, width: area.width, height: area.height }
  return (
    point.x >= rect.x - HOVER_PAD &&
    point.y >= rect.y - HOVER_PAD &&
    point.x <= rect.x + rect.width + HOVER_PAD &&
    point.y <= rect.y + rect.height + HOVER_PAD
  )
}

/**
 * Fallback capture decision from the real cursor position. Only ever *adds* capture when
 * the renderer missed a forwarded mousemove; the renderer stays authoritative for drags.
 */
function pollCursor(): void {
  if (!overlay || overlay.isDestroyed()) return
  const config = store.get()
  // A fullscreen chat area is the whole window, so polling cannot tell "over the chat" apart
  // from "anywhere" — the renderer already decides that case. Polling needs a concrete rect.
  if (!config.overlay.visible || !config.overlay.pollCursor || !config.overlay.clickThrough || !config.overlay.chat) {
    return
  }

  const area = workArea()
  const cursor = screen.getCursorScreenPoint()
  const local = { x: cursor.x - area.x, y: cursor.y - area.y }
  if (insideZone(local)) {
    applyInteractive({ interactive: true, focus: lastInteractive.focus })
  } else if (!lastInteractive.interactive) {
    applyInteractive({ interactive: false, focus: false })
  }
}

function startCursorPoll(): void {
  if (pollTimer) return
  pollTimer = setInterval(pollCursor, POLL_MS)
}

export function stopCursorPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** The cursor watcher only runs when the user turned it on in the settings modal. */
function syncCursorPoll(): void {
  if (store.get().overlay.pollCursor) startCursorPoll()
  else stopCursorPoll()
}

/** Current capture state, for diagnostics and the UI probe. */
export function interactionSnapshot(): {
  target: InteractiveState
  ignoreMouse: boolean
  focusable: boolean
  visible: boolean
  polling: boolean
} {
  return {
    target: lastInteractive,
    ignoreMouse: !appliedInteractive,
    focusable: appliedFocus,
    visible: Boolean(overlay && !overlay.isDestroyed() && overlay.isVisible()),
    polling: pollTimer !== null && store.get().overlay.pollCursor
  }
}

export function togglePanel(): void {
  broadcast(IPC.panelToggle)
}

export function createOverlay(): BrowserWindow {
  const area = workArea()

  overlay = new BrowserWindow({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    roundedCorners: false,
    alwaysOnTop: true,
    title: 'ChatXown',
    webPreferences: {
      preload: PRELOAD(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  })

  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlay.setMenuBarVisibility(false)
  overlay.setIgnoreMouseEvents(true, { forward: true })

  appliedInteractive = false
  appliedFocus = false
  lastInteractive = { interactive: false, focus: false }

  loadRenderer(overlay)

  overlay.once('ready-to-show', () => {
    if (store.get().overlay.visible) overlay?.showInactive()
    applyInteractive(lastInteractive, { force: true })
    syncCursorPoll()
  })

  overlay.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    overlayAction('hide')
  })

  overlay.on('closed', () => {
    overlay = null
    appliedInteractive = false
    appliedFocus = false
    stopCursorPoll()
  })

  return overlay
}

/** Reposition the fullscreen window when displays or scaling change. */
export function bindToDisplay(): void {
  if (!overlay || overlay.isDestroyed()) return
  const area = workArea()
  overlay.setBounds(area)
  overlay.setAlwaysOnTop(true, 'screen-saver')
  applyInteractive(lastInteractive, { force: true })
}

export function applyOverlayConfig(): void {
  if (!overlay || overlay.isDestroyed()) return
  const config = store.get()
  overlay.setAlwaysOnTop(true, 'screen-saver')
  syncCursorPoll()
  if (config.overlay.visible) {
    if (!overlay.isVisible()) overlay.showInactive()
  } else if (overlay.isVisible()) {
    overlay.hide()
  }
  // Visible first, styles second: the window must exist before the transparent style lands.
  applyInteractive(lastInteractive, { force: true })
}

export function overlayAction(action: OverlayAction): void {
  if (action === 'toggle-click-through') {
    store.patch({ overlay: { clickThrough: !store.get().overlay.clickThrough } })
    return
  }
  if (action === 'hide') {
    applyInteractive({ interactive: false, focus: false }, { force: true })
    overlay?.hide()
    store.patch({ overlay: { visible: false } })
    return
  }
  if (action === 'show') {
    store.patch({ overlay: { visible: true } })
    applyOverlayConfig()
    return
  }
  if (action === 'close') {
    quitting = true
    overlay?.close()
  }
}

export function toggleOverlayVisible(): void {
  overlayAction(store.get().overlay.visible ? 'hide' : 'show')
}

export function toggleClickThrough(): void {
  overlayAction('toggle-click-through')
}

export function markQuitting(): void {
  quitting = true
  stopCursorPoll()
}
