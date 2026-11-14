import type { ModRequest, ModResult } from '../../shared/types'
import { store } from '../store'
import { auth } from './auth'
import { Helix, HelixError } from './helix'

export const helix = new Helix(auth, () => store.get().twitch.clientId)

function mapError(error: unknown): ModResult {
  if (error instanceof HelixError) {
    if (error.status === 401) {
      return { ok: false, error: 'Сессия Twitch истекла — войдите заново' }
    }
    if (error.status === 403) {
      return { ok: false, error: 'Нет прав модератора на этом канале' }
    }
    if (error.status === 404) {
      return { ok: false, error: 'Сообщение или пользователь не найдены' }
    }
    return { ok: false, error: error.message }
  }
  return { ok: false, error: (error as Error)?.message ?? 'Неизвестная ошибка' }
}

export async function performModeration(request: ModRequest): Promise<ModResult> {
  const me = auth.status()
  if (!me.loggedIn || !me.userId) {
    return { ok: false, error: 'Нужно войти в Twitch: Настройки → Аккаунт Twitch' }
  }

  const source = store.get().sources.find((s) => s.id === request.sourceId)
  if (!source || source.platform !== 'twitch') {
    return { ok: false, error: 'Источник не найден' }
  }

  try {
    const broadcasterId = await helix.getUserId(source.channel)
    if (!broadcasterId) return { ok: false, error: `Канал ${source.channel} не найден в Twitch` }

    if (request.action === 'delete') {
      if (!request.messageId) return { ok: false, error: 'Не передан id сообщения' }
      const twitchId = request.messageId.split(':').slice(1).join(':')
      await helix.request<void>('DELETE', '/moderation/chat', {
        broadcaster_id: broadcasterId,
        moderator_id: me.userId,
        message_id: twitchId
      })
      return { ok: true }
    }

    if (!request.userId) return { ok: false, error: 'Не передан id пользователя' }

    if (request.action === 'unban') {
      await helix.request<void>('DELETE', '/moderation/banned', {
        broadcaster_id: broadcasterId,
        moderator_id: me.userId,
        user_id: request.userId
      })
      return { ok: true }
    }

    const data: Record<string, unknown> = { user_id: request.userId }
    if (request.reason) data.reason = request.reason.slice(0, 500)
    if (request.action === 'timeout' && request.duration) {
      data.duration = Math.min(Math.max(Math.round(request.duration), 1), 1209600)
    }
    await helix.request<void>('POST', '/moderation/bans', {
      broadcaster_id: broadcasterId,
      moderator_id: me.userId
    }, { data })

    return { ok: true }
  } catch (error) {
    return mapError(error)
  }
}
