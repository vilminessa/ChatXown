import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AddSourceResult,
  AppConfig,
  AuthStatus,
  ChatEvent,
  ClearPayload,
  DeviceFlowStart,
  DevicePollResult,
  ModRequest,
  ModResult,
  OverlayAction,
  Platform,
  SourceConfig,
  SourceStatus
} from '../shared/types'

export interface AppState {
  config: AppConfig
  statuses: SourceStatus[]
  auth: AuthStatus
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.configGet),
  patchConfig: (patch: unknown): Promise<AppConfig> => ipcRenderer.invoke(IPC.configPatch, patch),
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC.stateGet),
  addSource: (input: string, platform?: Platform): Promise<AddSourceResult> =>
    ipcRenderer.invoke(IPC.sourcesAdd, { input, platform }),
  updateSource: (id: string, patch: Partial<SourceConfig>): Promise<AddSourceResult> =>
    ipcRenderer.invoke(IPC.sourcesUpdate, { id, patch }),
  removeSource: (id: string): Promise<AppConfig> => ipcRenderer.invoke(IPC.sourcesRemove, id),
  overlayAction: (action: OverlayAction): Promise<void> =>
    ipcRenderer.invoke(IPC.overlayAction, action),
  openSettings: (): Promise<void> => ipcRenderer.invoke(IPC.openSettings),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),

  authStatus: (): Promise<AuthStatus> => ipcRenderer.invoke(IPC.authStatus),
  authDeviceStart: (
    clientId: string
  ): Promise<{ ok: boolean; device?: DeviceFlowStart; error?: string }> =>
    ipcRenderer.invoke(IPC.authDeviceStart, clientId),
  authDevicePoll: (clientId: string): Promise<DevicePollResult> =>
    ipcRenderer.invoke(IPC.authDevicePoll, clientId),
  authLogout: (): Promise<AuthStatus> => ipcRenderer.invoke(IPC.authLogout),

  moderate: (request: ModRequest): Promise<ModResult> => ipcRenderer.invoke(IPC.modAction, request),

  onEvent: (callback: (event: ChatEvent) => void): (() => void) =>
    subscribe<ChatEvent>(IPC.chatEvent, callback),
  onClear: (callback: (payload: ClearPayload) => void): (() => void) =>
    subscribe<ClearPayload>(IPC.chatClear, callback),
  onStatus: (callback: (statuses: SourceStatus[]) => void): (() => void) =>
    subscribe<SourceStatus[]>(IPC.chatStatus, callback),
  onConfig: (callback: (config: AppConfig) => void): (() => void) =>
    subscribe<AppConfig>(IPC.configChanged, callback),
  onAuthChanged: (callback: (auth: AuthStatus) => void): (() => void) =>
    subscribe<AuthStatus>(IPC.authChanged, callback)
}

export type ChatXownApi = typeof api

contextBridge.exposeInMainWorld('chatxown', api)
