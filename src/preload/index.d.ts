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

export interface ChatXownApi {
  getConfig(): Promise<AppConfig>
  patchConfig(patch: unknown): Promise<AppConfig>
  getState(): Promise<AppState>
  addSource(input: string, platform?: Platform): Promise<AddSourceResult>
  updateSource(id: string, patch: Partial<SourceConfig>): Promise<AddSourceResult>
  removeSource(id: string): Promise<AppConfig>
  overlayAction(action: OverlayAction): Promise<void>
  openSettings(): Promise<void>
  openExternal(url: string): Promise<void>

  authStatus(): Promise<AuthStatus>
  authDeviceStart(
    clientId: string
  ): Promise<{ ok: boolean; device?: DeviceFlowStart; error?: string }>
  authDevicePoll(clientId: string): Promise<DevicePollResult>
  authLogout(): Promise<AuthStatus>

  moderate(request: ModRequest): Promise<ModResult>

  onEvent(callback: (event: ChatEvent) => void): () => void
  onClear(callback: (payload: ClearPayload) => void): () => void
  onStatus(callback: (statuses: SourceStatus[]) => void): () => void
  onConfig(callback: (config: AppConfig) => void): () => void
  onAuthChanged(callback: (auth: AuthStatus) => void): () => void
}

declare global {
  interface Window {
    chatxown: ChatXownApi
  }
}
