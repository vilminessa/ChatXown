import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import type { OverlayAction, WindowBounds } from '../shared/types'
import { store } from './store'

let overlay: BrowserWindow | null = null
let settings: BrowserWindow | null = null
let boundsTimer: NodeJS.Timeout | null = null
let quitting = false

const RENDERER_URL = process.env['ELECTRON_RENDERER_URL']
const PRELOAD = (): string => join(__dirname, '../preload/index.js')

export function resourcePath(file: string): string {
  return join(process.env['ELECTRON_RENDERER_URL'] ? process.cwd() : process.resourcesPath, 'resources', file)
}

function loadRenderer(win: BrowserWindow, page: 'overlay' | 'settings'): void {
  if (RENDERER_URL) {
    void win.loadURL(`${RENDERER_URL}/${page}/index.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${page}/index.html`))
  }
}

function defaultBounds(): WindowBounds {
  const area = screen.getPrimaryDisplay().workArea
  const width = 400
  const height = Math.min(760, area.height - 120)
  return {
    x: area.x + area.width - width - 24,
    y: area.y + 60,
    width,
    height
  }
}

function fitsOnSomeDisplay(bounds: WindowBounds): boolean {
  return screen.getAllDisplays().some((display) => {
    const a = display.workArea
    const overlapX = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x)
    const overlapY = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y)
    return overlapX >= 120 && overlapY >= 120
  })
}

export function getOverlay(): BrowserWindow | null {
  return overlay
}

export function createOverlay(): BrowserWindow {
  const config = store.get()
  const saved = config.overlay.bounds
  const bounds = saved && fitsOnSomeDisplay(saved) ? saved : defaultBounds()

  overlay = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    roundedCorners: false,
    alwaysOnTop: true,
    title: 'ChatXown',
    icon: undefined,
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
  overlay.setIgnoreMouseEvents(config.overlay.clickThrough, { forward: true })

  loadRenderer(overlay, 'overlay')

  overlay.once('ready-to-show', () => {
    if (store.get().overlay.visible) overlay?.showInactive()
  })

  const persistBounds = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      boundsTimer = null
      if (!overlay || overlay.isDestroyed()) return
      store.patch({ overlay: { bounds: overlay.getBounds() } })
    }, 600)
  }

  overlay.on('move', persistBounds)
  overlay.on('resize', persistBounds)

  overlay.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    overlay?.hide()
    store.patch({ overlay: { visible: false } })
  })

  overlay.on('closed', () => {
    overlay = null
  })

  return overlay
}

export function openSettings(): void {
  if (settings && !settings.isDestroyed()) {
    settings.show()
    settings.focus()
    return
  }
  settings = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    show: false,
    backgroundColor: '#0f0f15',
    autoHideMenuBar: true,
    title: 'ChatXown — настройки',
    icon: resourcePath('icon.png'),
    webPreferences: {
      preload: PRELOAD(),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  settings.setMenuBarVisibility(false)
  loadRenderer(settings, 'settings')
  settings.once('ready-to-show', () => settings?.show())
  settings.on('closed', () => {
    settings = null
  })
}

export function applyOverlayConfig(): void {
  if (!overlay || overlay.isDestroyed()) return
  const config = store.get()
  overlay.setIgnoreMouseEvents(config.overlay.clickThrough, { forward: true })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  if (config.overlay.visible) {
    if (!overlay.isVisible()) overlay.showInactive()
  } else if (overlay.isVisible()) {
    overlay.hide()
  }
}

export function overlayAction(action: OverlayAction): void {
  if (action === 'toggle-click-through') {
    const next = !store.get().overlay.clickThrough
    store.patch({ overlay: { clickThrough: next } })
    return
  }
  if (action === 'hide') {
    overlay?.hide()
    store.patch({ overlay: { visible: false } })
    return
  }
  if (action === 'show') {
    store.patch({ overlay: { visible: true } })
    applyOverlayConfig()
    return
  }
  if (action === 'open-settings') {
    openSettings()
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
