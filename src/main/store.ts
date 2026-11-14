import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  AppConfig,
  AppearanceConfig,
  EmoteProviders,
  Platform,
  ScreenRect,
  SourceConfig
} from '../shared/types'
import { MIN_CHAT } from '../shared/layout'
import { parseSourceInput } from '../shared/sources'

export const ACCENTS = ['#9146ff', '#ff5b5b', '#4ecdc4', '#ffb347', '#7dd3fc', '#f472b6']

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  fontSize: 15,
  opacity: 0.55,
  maxMessages: 150,
  showBadges: true,
  showTimestamps: false,
  showSourceColor: true,
  hideAfterMs: 0,
  maxBubbleWidth: 440
}

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    sources: [makeSource('twitch', 'vilminessa_', 0)],
    appearance: { ...DEFAULT_APPEARANCE },
    overlay: { clickThrough: true, visible: true, chat: null },
    twitch: { clientId: '' }
  }
}

export function makeSource(platform: Platform, channel: string, index: number): SourceConfig {
  return {
    id: randomUUID(),
    platform,
    channel,
    label: channel,
    enabled: true,
    accent: ACCENTS[index % ACCENTS.length],
    emotes: { bttv: true, ffz: true, sevenTv: true },
    filter: { hideUsers: [], hideWords: [] }
  }
}

export type { ParsedSource } from '../shared/sources'
export { parseSourceInput }

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function normalizeSource(raw: any, index: number): SourceConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const platform: Platform = raw.platform === 'youtube' ? 'youtube' : 'twitch'
  const parsed = parseSourceInput(String(raw.channel ?? ''), platform)
  if (!parsed.channel || parsed.error) return null

  const emotes: EmoteProviders = {
    bttv: raw.emotes?.bttv !== false,
    ffz: raw.emotes?.ffz !== false,
    sevenTv: raw.emotes?.sevenTv !== false
  }

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : randomUUID(),
    platform,
    channel: parsed.channel,
    label: String(raw.label || parsed.channel),
    enabled: raw.enabled !== false,
    accent: /^#[0-9a-f]{6}$/i.test(String(raw.accent)) ? raw.accent : ACCENTS[index % ACCENTS.length],
    emotes,
    filter: {
      hideUsers: Array.isArray(raw.filter?.hideUsers)
        ? raw.filter.hideUsers.map(String).slice(0, 500)
        : [],
      hideWords: Array.isArray(raw.filter?.hideWords)
        ? raw.filter.hideWords.map(String).slice(0, 500)
        : []
    }
  }
}

export function sanitizeConfig(raw: any): AppConfig {
  const fallback = defaultConfig()
  if (!raw || typeof raw !== 'object') return fallback

  const sources = Array.isArray(raw.sources)
    ? raw.sources
        .map((s: unknown, i: number) => normalizeSource(s, i))
        .filter((s: SourceConfig | null): s is SourceConfig => s !== null)
    : fallback.sources

  const a = raw.appearance ?? {}
  const appearance: AppearanceConfig = {
    fontSize: clamp(Number(a.fontSize), 10, 42, DEFAULT_APPEARANCE.fontSize),
    opacity: clamp(Number(a.opacity), 0, 1, DEFAULT_APPEARANCE.opacity),
    maxMessages: Math.round(clamp(Number(a.maxMessages), 10, 1000, DEFAULT_APPEARANCE.maxMessages)),
    showBadges: a.showBadges !== false,
    showTimestamps: a.showTimestamps === true,
    showSourceColor: a.showSourceColor !== false,
    hideAfterMs: Math.round(clamp(Number(a.hideAfterMs), 0, 600_000, 0)),
    maxBubbleWidth: Math.round(clamp(Number(a.maxBubbleWidth), 160, 1200, DEFAULT_APPEARANCE.maxBubbleWidth))
  }

  /** `chat` replaced the old window `bounds`; both shapes are accepted. */
  function normalizeChat(raw: any): ScreenRect | null {
    const legacy = raw?.chat ?? raw?.bounds
    if (!legacy || typeof legacy !== 'object') return null
    const width = Math.round(Number(legacy.width))
    const height = Math.round(Number(legacy.height))
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < MIN_CHAT.width ||
      height < MIN_CHAT.height
    ) {
      return null
    }
    return {
      x: Math.round(clamp(Number(legacy.x), 0, 100_000, 0)),
      y: Math.round(clamp(Number(legacy.y), 0, 100_000, 0)),
      width,
      height
    }
  }

  return {
    version: 1,
    sources,
    appearance,
    overlay: {
      clickThrough: raw.overlay?.clickThrough !== false,
      visible: raw.overlay?.visible !== false,
      chat: normalizeChat(raw.overlay)
    },
    twitch: { clientId: String(raw.twitch?.clientId ?? '') }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch === undefined ? base : (patch as T))
  }
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    out[key] = isPlainObject(out[key]) && isPlainObject(value)
      ? mergeDeep(out[key], value)
      : value
  }
  return out as T
}

export class ConfigStore extends EventEmitter {
  private data: AppConfig = defaultConfig()
  private file = ''
  private saveTimer: NodeJS.Timeout | null = null

  init(): void {
    this.file = join(app.getPath('userData'), 'config.json')
    try {
      if (existsSync(this.file)) {
        this.data = sanitizeConfig(JSON.parse(readFileSync(this.file, 'utf8')))
      } else {
        this.data = defaultConfig()
        this.writeNow()
      }
    } catch (error) {
      console.error('[config] failed to load, using defaults', error)
      this.data = defaultConfig()
    }
  }

  get(): AppConfig {
    return this.data
  }

  set(next: AppConfig): AppConfig {
    this.data = sanitizeConfig(next)
    this.emit('change', this.data)
    this.scheduleWrite()
    return this.data
  }

  patch(patch: unknown): AppConfig {
    return this.set(mergeDeep(this.data, patch))
  }

  private scheduleWrite(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.writeNow()
    }, 300)
  }

  writeNow(): void {
    if (!this.file) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2))
      renameSync(tmp, this.file)
    } catch (error) {
      console.error('[config] failed to save', error)
    }
  }
}

export const store = new ConfigStore()
