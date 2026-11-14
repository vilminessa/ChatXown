import { useEffect, useState } from 'react'
import type { AppearanceConfig, ChatEvent, ModAction } from '../../../shared/types'

interface MessageProps {
  event: ChatEvent
  appearance: AppearanceConfig
  accent?: string
  canModerate?: boolean
  selfUserId?: string
  onModerate?: (event: ChatEvent, action: ModAction) => void
}

const SYSTEM_KINDS = new Set(['sub', 'resub', 'gift', 'raid', 'system'])

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function Message({
  event,
  appearance,
  accent,
  canModerate = false,
  selfUserId,
  onModerate
}: MessageProps): React.JSX.Element {
  const isSystem = SYSTEM_KINDS.has(event.kind)
  const isAction = event.kind === 'action'
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(timer)
  }, [armed])

  const className = ['msg', `kind-${event.kind}`, isSystem ? 'system' : '', isAction ? 'action' : '']
    .filter(Boolean)
    .join(' ')

  const moddable =
    canModerate &&
    Boolean(onModerate) &&
    event.platform === 'twitch' &&
    !isSystem &&
    Boolean(event.author.userId) &&
    event.author.userId !== selfUserId

  const act = (action: ModAction): void => {
    setArmed(false)
    onModerate?.(event, action)
  }

  return (
    <div
      className={className}
      style={{
        ['--bg-alpha' as string]: appearance.opacity,
        borderLeftColor: appearance.showSourceColor ? (accent ?? 'transparent') : 'transparent'
      }}
    >
      {appearance.showTimestamps && <span className="ts">{formatTime(event.ts)}</span>}

      {appearance.showBadges &&
        event.author.badges.map((badge, index) =>
          badge.url ? (
            <img
              key={`${badge.id}-${index}`}
              className="badge"
              src={badge.url}
              alt=""
              title={badge.title ?? badge.id}
              draggable={false}
            />
          ) : (
            <span
              key={`${badge.id}-${index}`}
              className="badge-text"
              title={badge.title ?? badge.id}
            >
              {badge.label ?? badge.title ?? badge.id}
            </span>
          )
        )}

      {isSystem ? (
        <span className="sys">
          <span className="sys-icon">{event.kind === 'raid' ? '⚔' : event.kind === 'gift' ? '🎁' : '★'}</span>
          {event.text}
        </span>
      ) : (
        <>
          <span
            className={`nick ${event.author.isBroadcaster ? 'broadcaster' : ''} ${event.author.isMod ? 'mod' : ''}`}
            style={{ color: isAction ? accent : event.author.color }}
          >
            {event.author.displayName}
          </span>
          {event.kind === 'cheer' && event.amount && <span className="bits">◆ {event.amount}</span>}
          <span className="sep">: </span>
          <span className="text">
            {event.fragments.map((fragment, index) =>
              fragment.type === 'text' ? (
                <span key={index}>{fragment.text}</span>
              ) : (
                <img
                  key={index}
                  className="emote"
                  src={fragment.url}
                  alt={fragment.alt}
                  title={fragment.alt}
                  draggable={false}
                />
              )
            )}
          </span>
        </>
      )}

      {moddable && (
        <span className="mod-bar">
          <button className="mod-btn" title="Удалить сообщение" onClick={() => act('delete')}>
            ⌫
          </button>
          <button className="mod-btn" title="Таймаут на 10 минут" onClick={() => act('timeout')}>
            10м
          </button>
          <button
            className={`mod-btn mod-btn-ban ${armed ? 'armed' : ''}`}
            title={armed ? 'Нажмите ещё раз, чтобы забанить' : 'Забанить навсегда'}
            onClick={() => (armed ? act('ban') : setArmed(true))}
          >
            {armed ? 'Точно?' : 'Бан'}
          </button>
        </span>
      )}
    </div>
  )
}
