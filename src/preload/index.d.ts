import type {
  AddSourceResult,
  AppConfig,
  ChatEvent,
  ClearPayload,
  OverlayAction,
  Platform,
  SourceConfig,
  SourceStatus
} from '../shared/types'

export interface ChatXownApi {
  getConfig(): Promise<AppConfig>
  patchConfig(patch: unknown): Promise<AppConfig>
  getState(): Promise<{ config: AppConfig; statuses: SourceStatus[] }>
  addSource(input: string, platform?: Platform): Promise<AddSourceResult>
  updateSource(id: string, patch: Partial<SourceConfig>): Promise<AddSourceResult>
  removeSource(id: string): Promise<AppConfig>
  overlayAction(action: OverlayAction): Promise<void>
  openSettings(): Promise<void>
  openExternal(url: string): Promise<void>

  onEvent(callback: (event: ChatEvent) => void): () => void
  onClear(callback: (payload: ClearPayload) => void): () => void
  onStatus(callback: (statuses: SourceStatus[]) => void): () => void
  onConfig(callback: (config: AppConfig) => void): () => void
}

declare global {
  interface Window {
    chatxown: ChatXownApi
  }
}
