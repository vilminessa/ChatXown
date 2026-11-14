import type { TwitchAuth } from './auth'

export class HelixError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
    this.name = 'HelixError'
  }
}

type Query = Record<string, string | number | undefined>

export class Helix {
  private userCache = new Map<string, { id: string; at: number }>()

  constructor(
    private auth: TwitchAuth,
    private clientId: () => string
  ) {}

  async request<T>(
    method: string,
    path: string,
    query?: Query,
    body?: unknown
  ): Promise<T> {
    const token = await this.auth.getToken()
    if (!token) throw new HelixError(401, 'Нужно войти в Twitch')

    const url = new URL(`https://api.twitch.tv/helix${path}`)
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
    }

    const res = await fetch(url.toString(), {
      method,
      headers: {
        'Client-Id': this.clientId(),
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })

    if (!res.ok) {
      let message = `Twitch вернул ${res.status}`
      try {
        const json = (await res.json()) as { message?: string }
        if (json?.message) message = json.message
      } catch {
        /* ignore */
      }
      throw new HelixError(res.status, message)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  async getUserId(login: string): Promise<string | null> {
    const key = login.toLowerCase()
    const cached = this.userCache.get(key)
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.id

    const json = await this.request<{ data: Array<{ id: string; login: string }> }>('GET', '/users', {
      login: key
    })
    const user = json.data?.[0]
    if (!user) return null
    this.userCache.set(key, { id: user.id, at: Date.now() })
    return user.id
  }
}
