import { ipcMain, shell } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AddSourceResult,
  AppConfig,
  AuthStatus,
  DeviceFlowStart,
  DevicePollResult,
  InteractiveState,
  ModRequest,
  ModResult,
  OverlayAction,
  Platform,
  ScreenRect,
  SourceConfig,
  SourceStatus
} from '../shared/types'
import { makeSource, parseSourceInput, store } from './store'
import { auth } from './twitch/auth'
import { performModeration } from './twitch/moderation'

export interface IpcDeps {
  getStatuses: () => SourceStatus[]
  overlayAction: (action: OverlayAction) => void
  setInteractive: (state: InteractiveState) => void
  broadcast: (channel: string, payload?: unknown) => void
}

const MAX_SOURCES = 24

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle(IPC.configGet, (): AppConfig => store.get())

  ipcMain.handle(IPC.configPatch, (_event, patch: unknown): AppConfig => store.patch(patch))

  ipcMain.handle(
    IPC.stateGet,
    (): { config: AppConfig; statuses: SourceStatus[]; auth: AuthStatus } => ({
      config: store.get(),
      statuses: deps.getStatuses(),
      auth: auth.status()
    })
  )

  ipcMain.handle(
    IPC.sourcesAdd,
    (_event, payload: { input: string; platform?: Platform }): AddSourceResult => {
      const config = store.get()
      if (config.sources.length >= MAX_SOURCES) {
        return { ok: false, error: `Максимум ${MAX_SOURCES} источников` }
      }

      const parsed = parseSourceInput(payload?.input ?? '', payload?.platform)
      if (parsed.error || !parsed.channel) {
        return { ok: false, error: parsed.error ?? 'Не удалось распознать канал' }
      }
      if (config.sources.some((s) => s.platform === parsed.platform && s.channel === parsed.channel)) {
        return { ok: false, error: `Канал ${parsed.channel} уже добавлен` }
      }

      const source = makeSource(parsed.platform, parsed.channel, config.sources.length)
      const next = store.set({ ...config, sources: [...config.sources, source] })
      return { ok: true, config: next }
    }
  )

  ipcMain.handle(
    IPC.sourcesUpdate,
    (_event, payload: { id: string; patch: Partial<SourceConfig> }): AddSourceResult => {
      const config = store.get()
      const index = config.sources.findIndex((s) => s.id === payload?.id)
      if (index === -1) return { ok: false, error: 'Источник не найден' }

      const current = config.sources[index]
      const patch = payload.patch ?? {}
      const updated: SourceConfig = { ...current }

      if (typeof patch.label === 'string') updated.label = patch.label.slice(0, 60)
      if (typeof patch.enabled === 'boolean') updated.enabled = patch.enabled
      if (typeof patch.accent === 'string' && /^#[0-9a-f]{6}$/i.test(patch.accent)) {
        updated.accent = patch.accent
      }
      if (patch.emotes) {
        updated.emotes = {
          bttv: patch.emotes.bttv !== false,
          ffz: patch.emotes.ffz !== false,
          sevenTv: patch.emotes.sevenTv !== false
        }
      }
      if (patch.filter) {
        updated.filter = {
          hideUsers: (patch.filter.hideUsers ?? current.filter.hideUsers).map(String).slice(0, 500),
          hideWords: (patch.filter.hideWords ?? current.filter.hideWords).map(String).slice(0, 500)
        }
      }
      if (typeof patch.channel === 'string' && patch.channel !== current.channel) {
        const parsed = parseSourceInput(patch.channel, current.platform)
        if (parsed.error) return { ok: false, error: parsed.error }
        updated.channel = parsed.channel
      }

      const sources = [...config.sources]
      sources[index] = updated
      return { ok: true, config: store.set({ ...config, sources }) }
    }
  )

  ipcMain.handle(IPC.sourcesRemove, (_event, id: string): AppConfig => {
    const config = store.get()
    return store.set({ ...config, sources: config.sources.filter((s) => s.id !== id) })
  })

  ipcMain.handle(IPC.overlayAction, (_event, action: OverlayAction): void => {
    deps.overlayAction(action)
  })

  ipcMain.on(IPC.overlayInteractive, (_event, state: InteractiveState): void => {
    deps.setInteractive(state)
  })

  ipcMain.handle(IPC.chatSet, (_event, rect: ScreenRect | null): AppConfig => {
    return store.patch({ overlay: { chat: rect } })
  })

  ipcMain.handle(IPC.openExternal, (_event, url: string): void => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
  })

  ipcMain.handle(IPC.authStatus, (): AuthStatus => auth.status())

  ipcMain.handle(
    IPC.authDeviceStart,
    async (_event, clientId: string): Promise<{ ok: boolean; device?: DeviceFlowStart; error?: string }> => {
      try {
        const device = await auth.startDevice(clientId)
        return { ok: true, device }
      } catch (error) {
        return { ok: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.authDevicePoll, async (_event, clientId: string): Promise<DevicePollResult> => {
    const result = await auth.pollDevice(clientId)
    if (result.state === 'ok' || result.state === 'error' || result.state === 'expired') {
      deps.broadcast(IPC.authChanged, result.auth)
    }
    return result
  })

  ipcMain.handle(IPC.authLogout, (): AuthStatus => {
    auth.logout()
    const status = auth.status()
    deps.broadcast(IPC.authChanged, status)
    return status
  })

  ipcMain.handle(IPC.modAction, (_event, request: ModRequest): Promise<ModResult> => {
    return performModeration(request)
  })
}
