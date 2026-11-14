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
  InteractiveState,
  ModRequest,
  ModResult,
  OverlayAction,
  Platform,
  ScreenRect,
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
  /** Report whether the pointer sits over a UI zone that must capture input. */
  setInteractive: (state: InteractiveState): void =>
    ipcRenderer.send(IPC.overlayInteractive, state),
  /** Persist the chat area rect (null = fill the whole overlay). */
  setChat: (rect: ScreenRect | null): Promise<AppConfig> => ipcRenderer.invoke(IPC.chatSet, rect),
  onPanelToggle: (callback: () => void): (() => void) =>
    subscribe<unknown>(IPC.panelToggle, () => callback()),
  /** Main reports a click-through toggle so the overlay can show a toast. */
  onCapture: (callback: (payload: { clickThrough: boolean }) => void): (() => void) =>
    subscribe<{ clickThrough: boolean }>(IPC.overlayCapture, callback),
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
