import { app, Menu, Tray, nativeImage } from 'electron'
import { store } from './store'
import {
  openSettings,
  overlayAction,
  resourcePath,
  toggleClickThrough,
  toggleOverlayVisible
} from './windows'

let tray: Tray | null = null

function buildMenu(): Menu {
  const config = store.get()
  return Menu.buildFromTemplate([
    { label: 'ChatXown', enabled: false },
    { type: 'separator' },
    {
      label: config.overlay.visible ? 'Скрыть оверлей' : 'Показать оверлей',
      click: () => toggleOverlayVisible()
    },
    {
      label: 'Сквозной режим (клики проходят)',
      type: 'checkbox',
      checked: config.overlay.clickThrough,
      click: () => toggleClickThrough()
    },
    { label: 'Настройки…', click: () => openSettings() },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        overlayAction('show')
        app.quit()
      }
    }
  ])
}

export function refreshTray(): void {
  if (!tray || tray.isDestroyed()) return
  tray.setContextMenu(buildMenu())
  tray.setToolTip('ChatXown — оверлей чата')
}

export function createTray(): void {
  const icon = nativeImage.createFromPath(resourcePath('tray.png'))
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)

  if (process.platform === 'win32') {
    tray.on('double-click', () => openSettings())
  }
  tray.on('click', () => toggleOverlayVisible())

  refreshTray()
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}
