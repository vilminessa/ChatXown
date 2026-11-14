import type { AppearanceConfig, ChatEvent } from '../../../shared/types'

interface MessageProps {
  event: ChatEvent
  appearance: AppearanceConfig
  accent?: string
}

const SYSTEM_KINDS = new Set(['sub', 'resub', 'gift', 'raid', 'system'])

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

export function Message({ event, appearance, accent }: MessageProps): React.JSX.Element {
  const isSystem = SYSTEM_KINDS.has(event.kind)
  const isAction = event.kind === 'action'

  const className = ['msg', `kind-${event.kind}`, isSystem ? 'system' : '', isAction ? 'action' : '']
    .filter(Boolean)
    .join(' ')

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
        event.author.badges.map((badge, index) => (
          <img
            key={`${badge.id}-${index}`}
            className="badge"
            src={badge.url}
            alt=""
            title={badge.title ?? badge.id}
            draggable={false}
          />
        ))}

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
    </div>
  )
}
