import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { initEmoteCache } from './chat/emotes'
import { ChatManager } from './chat/manager'
import { registerHotkeys, unregisterHotkeys } from './hotkeys'
import { registerIpc } from './ipc'
import { IPC } from '../shared/ipc'
import type { AppConfig } from '../shared/types'
import { store } from './store'
import { createTray, destroyTray, refreshTray } from './tray'
import { auth } from './twitch/auth'
import {
  applyOverlayConfig,
  createOverlay,
  markQuitting,
  openSettings,
  overlayAction,
  toggleClickThrough,
  toggleOverlayVisible
} from './windows'

const singleInstance = app.requestSingleInstanceLock()
if (!singleInstance) {
  app.quit()
}

let manager: ChatManager | null = null
let lastSourcesSignature = ''

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function start(): void {
  store.init()
  initEmoteCache(join(app.getPath('userData'), 'emotes-cache.json'))
  auth.init(join(app.getPath('userData'), 'auth.json'))

  createOverlay()

  manager = new ChatManager({
    onEvent: (event) => {
      if (process.env['CHATXOWN_DEBUG']) {
        const emotes = event.fragments.filter((f) => f.type === 'emote').length
        console.log(
          `[event] #${event.channel} ${event.author.displayName}: ${event.text.slice(0, 80)}` +
            ` [frags=${event.fragments.length} emotes=${emotes}]`
        )
      }
      broadcast(IPC.chatEvent, event)
    },
    onClear: (payload) => broadcast(IPC.chatClear, payload),
    onStatus: (statuses) => {
      if (process.env['CHATXOWN_DEBUG']) {
        console.log('[status]', statuses.map((s) => `${s.channel}:${s.state}`).join(', '))
      }
      broadcast(IPC.chatStatus, statuses)
    }
  })

  const config = store.get()
  lastSourcesSignature = JSON.stringify(config.sources)
  manager.setSources(config.sources)
  applyOverlayConfig()

  store.on('change', (next: AppConfig) => {
    const signature = JSON.stringify(next.sources)
    if (signature !== lastSourcesSignature) {
      lastSourcesSignature = signature
      manager?.setSources(next.sources)
    }
    applyOverlayConfig()
    broadcast(IPC.configChanged, next)
    refreshTray()
  })

  registerIpc({
    getStatuses: () => manager?.getStatuses() ?? [],
    overlayAction,
    openSettings,
    broadcast
  })

  createTray()
  registerHotkeys({ toggleClickThrough, toggleVisible: toggleOverlayVisible, openSettings })

  if (process.env['CHATXOWN_DEMO']) {
    void import('./demo').then(({ startDemo }) =>
      startDemo(
        (event) => broadcast(IPC.chatEvent, event),
        () => store.get().sources
      )
    )
  }

  if (process.env['CHATXOWN_OPEN_SETTINGS']) {
    setTimeout(() => openSettings(), 1500)
  }

  if (process.env['CHATXOWN_CAPTURE']) {
    const target = process.env['CHATXOWN_CAPTURE']
    setTimeout(() => {
      void (async () => {
        try {
          const { writeFileSync } = await import('node:fs')
          const windows = BrowserWindow.getAllWindows()
          for (let i = 0; i < windows.length; i += 1) {
            const win = windows[i]
            const file = windows.length === 1 ? target : target.replace(/\.png$/, `-${i}.png`)
            const image = await win.webContents.capturePage()
            writeFileSync(file, image.toPNG())
            const text = await win.webContents
              .executeJavaScript('document.body.innerText')
              .catch(() => '')
            console.log(`[capture] ${win.getTitle()} -> ${file}`)
            console.log(`[dom:${win.getTitle()}]\n${text}`)
          }
        } catch (error) {
          console.error('[capture] failed', error)
        }
      })()
    }, 9000)
  }
}

app.whenReady().then(() => {
  start()
})

app.on('second-instance', () => {
  overlayAction('show')
  openSettings()
})

app.on('window-all-closed', () => {
  // Keep running in the tray.
})

app.on('before-quit', () => {
  markQuitting()
  store.writeNow()
  manager?.stop()
  unregisterHotkeys()
  destroyTray()
})

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createOverlay()
})
