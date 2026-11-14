import { globalShortcut } from 'electron'

export interface HotkeyHandlers {
  toggleClickThrough: () => void
  toggleVisible: () => void
  openSettings: () => void
}

export function registerHotkeys(handlers: HotkeyHandlers): void {
  const bind = (accelerator: string, handler: () => void): void => {
    try {
      const ok = globalShortcut.register(accelerator, handler)
      if (!ok) console.warn(`[hotkeys] ${accelerator} уже занят другим приложением`)
    } catch (error) {
      console.warn(`[hotkeys] failed to register ${accelerator}`, error)
    }
  }

  bind('Control+Alt+O', handlers.toggleClickThrough)
  bind('Control+Alt+H', handlers.toggleVisible)
  bind('Control+Alt+S', handlers.openSettings)
}

export function unregisterHotkeys(): void {
  globalShortcut.unregisterAll()
}
