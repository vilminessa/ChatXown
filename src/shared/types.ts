export type Platform = 'twitch' | 'youtube'

export interface EmoteProviders {
  bttv: boolean
  ffz: boolean
  sevenTv: boolean
}

export interface SourceFilter {
  hideUsers: string[]
  hideWords: string[]
}

export interface SourceConfig {
  id: string
  platform: Platform
  /** twitch login (lowercase) or youtube handle / url / video id */
  channel: string
  label: string
  enabled: boolean
  accent: string
  emotes: EmoteProviders
  filter: SourceFilter
}

export interface AppearanceConfig {
  fontSize: number
  /** background alpha of message bubbles, 0..1 */
  opacity: number
  maxMessages: number
  showBadges: boolean
  showTimestamps: boolean
  /** per-source accent stripe on the left of each message */
  showSourceColor: boolean
  /** fade out old messages (ms), 0 = never */
  hideAfterMs: number
  /** max bubble width in px */
  maxBubbleWidth: number
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface AppConfig {
  version: number
  sources: SourceConfig[]
  appearance: AppearanceConfig
  overlay: {
    clickThrough: boolean
    visible: boolean
    bounds: WindowBounds | null
  }
  twitch: {
    clientId: string
  }
}

export interface SourceStatus {
  id: string
  channel: string
  state: 'idle' | 'connecting' | 'connected' | 'error'
  detail?: string
}

/* ---------------------------------- chat --------------------------------- */

export interface Badge {
  id: string
  url: string
  title?: string
}

export interface EmoteDef {
  name: string
  url: string
}

export type Fragment =
  | { type: 'text'; text: string }
  | { type: 'emote'; url: string; alt: string }

export type ChatEventKind =
  | 'message'
  | 'action'
  | 'sub'
  | 'resub'
  | 'gift'
  | 'raid'
  | 'cheer'
  | 'system'

export interface ChatAuthor {
  name: string
  displayName: string
  color: string
  userId?: string
  badges: Badge[]
  isMod: boolean
  isBroadcaster: boolean
}

export interface ChatEvent {
  id: string
  platform: Platform
  sourceId: string
  channel: string
  kind: ChatEventKind
  author: ChatAuthor
  fragments: Fragment[]
  ts: number
  amount?: string
  /** fallback plain text for search / notifications */
  text: string
}

export interface ClearPayload {
  sourceId: string
  /** exact message ids to drop */
  ids?: string[]
  /** drop every message of this twitch user id */
  userId?: string
  /** drop everything from this source */
  all?: boolean
}

export type OverlayAction =
  | 'toggle-click-through'
  | 'set-click-through'
  | 'hide'
  | 'show'
  | 'open-settings'
  | 'close'

export interface AddSourceResult {
  ok: boolean
  error?: string
  config?: AppConfig
}
