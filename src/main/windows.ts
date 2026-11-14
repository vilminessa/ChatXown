import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { IPC } from '../shared/ipc'
import type { InteractiveState, OverlayAction } from '../shared/types'
import { store } from './store'

let overlay: BrowserWindow | null = null
let quitting = false
/** Last state requested by the renderer; replayed when config or displays change. */
let lastInteractive: InteractiveState = { interactive: false, focus: false }
let appliedInteractive = false
let appliedFocus = false

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

function applyInteractive(state: InteractiveState): void {
  if (!overlay || overlay.isDestroyed()) return
  lastInteractive = state
  // Click-through off means the whole screen captures input, regardless of the pointer.
  const interactive = state.interactive || !store.get().overlay.clickThrough
  const focus = interactive && state.focus
  if (interactive === appliedInteractive && focus === appliedFocus) return

  appliedInteractive = interactive
  appliedFocus = focus

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
  })

  return overlay
}

/** Reposition the fullscreen window when displays or scaling change. */
export function bindToDisplay(): void {
  if (!overlay || overlay.isDestroyed()) return
  const area = workArea()
  overlay.setBounds(area)
  overlay.setAlwaysOnTop(true, 'screen-saver')
}

export function applyOverlayConfig(): void {
  if (!overlay || overlay.isDestroyed()) return
  const config = store.get()
  overlay.setAlwaysOnTop(true, 'screen-saver')
  applyInteractive(lastInteractive)
  if (config.overlay.visible) {
    if (!overlay.isVisible()) overlay.showInactive()
  } else if (overlay.isVisible()) {
    overlay.hide()
  }
}

export function overlayAction(action: OverlayAction): void {
  if (action === 'toggle-click-through') {
    store.patch({ overlay: { clickThrough: !store.get().overlay.clickThrough } })
    return
  }
  if (action === 'hide') {
    applyInteractive({ interactive: false, focus: false })
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
}
