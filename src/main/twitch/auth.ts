import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AuthStatus, DeviceFlowStart, DevicePollResult } from '../../shared/types'

const OAUTH = 'https://id.twitch.tv/oauth2'

export const AUTH_SCOPES = [
  'moderator:manage:banned_users',
  'moderator:manage:chat_messages'
]

export interface TwitchTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: string[]
  login: string
  userId: string
  clientId: string
}

interface PendingDevice {
  deviceCode: string
  interval: number
  expiresAt: number
}

interface ValidateResponse {
  login: string
  user_id: string
  scopes: string[]
  expires_in: number
}

export class TwitchAuth {
  private tokens: TwitchTokens | null = null
  private pending: PendingDevice | null = null
  private file = ''

  init(file: string): void {
    this.file = file
    this.load()
    if (this.tokens) void this.refreshIfExpiring()
  }

  /* ------------------------------- persistence ------------------------------ */

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { enc: boolean; data: string }
      const json = raw.enc
        ? safeStorage.decryptString(Buffer.from(raw.data, 'base64'))
        : Buffer.from(raw.data, 'base64').toString('utf8')
      this.tokens = JSON.parse(json) as TwitchTokens
    } catch (error) {
      console.warn('[auth] failed to load tokens', error)
      this.tokens = null
    }
  }

  private persist(): void {
    if (!this.file) return
    try {
      if (!this.tokens) {
        if (existsSync(this.file)) unlinkSync(this.file)
        return
      }
      const json = JSON.stringify(this.tokens)
      const enc = safeStorage.isEncryptionAvailable()
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(
        this.file,
        JSON.stringify({
          enc,
          data: enc
            ? safeStorage.encryptString(json).toString('base64')
            : Buffer.from(json).toString('base64')
        })
      )
    } catch (error) {
      console.warn('[auth] failed to persist tokens', error)
    }
  }

  /* --------------------------------- status -------------------------------- */

  status(): AuthStatus {
    return {
      loggedIn: Boolean(this.tokens?.accessToken),
      login: this.tokens?.login,
      userId: this.tokens?.userId,
      scopes: this.tokens?.scopes,
      hasClientId: Boolean(this.tokens?.clientId)
    }
  }

  /* ------------------------------ device flow ------------------------------ */

  async startDevice(clientId: string): Promise<DeviceFlowStart> {
    if (!clientId) throw new Error('Укажите Client ID приложения Twitch в настройках')
    const params = new URLSearchParams({ client_id: clientId, scopes: AUTH_SCOPES.join(' ') })
    const res = await fetch(`${OAUTH}/device?${params.toString()}`, { method: 'POST' })
    const json = (await res.json()) as Record<string, any>
    if (!res.ok) throw new Error(json?.message ?? `Twitch вернул ${res.status}`)
    this.pending = {
      deviceCode: String(json.device_code),
      interval: Number(json.interval) || 5,
      expiresAt: Date.now() + (Number(json.expires_in) || 1800) * 1000
    }
    return {
      userCode: String(json.user_code),
      verificationUri: String(json.verification_uri),
      expiresIn: Number(json.expires_in) || 1800,
      interval: Number(json.interval) || 5
    }
  }

  async pollDevice(clientId: string): Promise<DevicePollResult> {
    const pending = this.pending
    if (!pending) {
      return { state: 'error', auth: this.status(), error: 'Вход не был начат' }
    }
    if (Date.now() > pending.expiresAt) {
      this.pending = null
      return { state: 'expired', auth: this.status(), error: 'Код истёк, начните вход заново' }
    }

    const body = new URLSearchParams({
      client_id: clientId,
      scopes: AUTH_SCOPES.join(' '),
      device_code: pending.deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
    const res = await fetch(`${OAUTH}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, any>

    if (res.ok) {
      this.pending = null
      await this.acceptTokens(clientId, json)
      return { state: 'ok', auth: this.status() }
    }

    const message = String(json.message ?? '')
    if (message === 'authorization_pending') {
      return { state: 'pending', auth: this.status() }
    }
    if (message === 'slow_down') {
      pending.interval += 5
      return { state: 'pending', auth: this.status() }
    }
    this.pending = null
    if (message === 'expired_token') {
      return { state: 'expired', auth: this.status(), error: 'Код истёк, начните вход заново' }
    }
    return {
      state: 'error',
      auth: this.status(),
      error: message === 'access_denied' ? 'Доступ отклонён' : message || `Twitch вернул ${res.status}`
    }
  }

  get pendingInterval(): number {
    return this.pending?.interval ?? 5
  }

  cancelDevice(): void {
    this.pending = null
  }

  /* --------------------------------- tokens -------------------------------- */

  private async acceptTokens(clientId: string, json: Record<string, any>): Promise<void> {
    const accessToken = String(json.access_token ?? '')
    if (!accessToken) throw new Error('Twitch не вернул access_token')
    const info = await this.validate(accessToken)
    this.tokens = {
      accessToken,
      refreshToken: String(json.refresh_token ?? ''),
      expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
      scopes: info?.scopes ?? AUTH_SCOPES,
      login: info?.login ?? '',
      userId: info?.user_id ?? '',
      clientId
    }
    this.persist()
  }

  private async validate(accessToken: string): Promise<ValidateResponse | null> {
    try {
      const res = await fetch(`${OAUTH}/validate`, {
        headers: { Authorization: `OAuth ${accessToken}` }
      })
      if (!res.ok) return null
      return (await res.json()) as ValidateResponse
    } catch {
      return null
    }
  }

  private async refreshIfExpiring(): Promise<void> {
    if (!this.tokens) return
    if (this.tokens.expiresAt - Date.now() > 5 * 60 * 1000) return
    try {
      await this.refresh()
    } catch {
      /* keep the tokens; a hard failure will surface on the next API call */
    }
  }

  private async refresh(): Promise<void> {
    const tokens = this.tokens
    if (!tokens?.refreshToken) throw new Error('Нет refresh token')
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: tokens.clientId
    })
    const res = await fetch(`${OAUTH}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
    if (!res.ok) {
      this.tokens = null
      this.persist()
      throw new Error('Сессия Twitch истекла, войдите заново')
    }
    const json = (await res.json()) as Record<string, any>
    this.tokens = {
      ...tokens,
      accessToken: String(json.access_token),
      refreshToken: String(json.refresh_token ?? tokens.refreshToken),
      expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000
    }
    this.persist()
  }

  async getToken(): Promise<string | null> {
    if (!this.tokens) return null
    if (this.tokens.expiresAt - Date.now() < 60_000) {
      try {
        await this.refresh()
      } catch {
        return null
      }
    }
    return this.tokens?.accessToken ?? null
  }

  invalidate(): void {
    this.tokens = null
    this.persist()
  }

  logout(): void {
    this.tokens = null
    this.pending = null
    this.persist()
  }
}

export const auth = new TwitchAuth()
