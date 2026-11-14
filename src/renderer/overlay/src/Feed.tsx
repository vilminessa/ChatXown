import { useEffect, useRef, useState } from 'react'
import type { AppearanceConfig, ChatEvent } from '../../../shared/types'
import { Message } from './Message'

interface FeedProps {
  events: ChatEvent[]
  config: { appearance: AppearanceConfig }
  accentById: Map<string, string>
}

export function Feed({ events, config, accentById }: FeedProps): React.JSX.Element {
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [showHint, setShowHint] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 12_000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (events.length > 0) setShowHint(false)
  }, [events.length])

  useEffect(() => {
    const el = scroller.current
    if (!el || !stick.current) return
    el.scrollTop = el.scrollHeight
  }, [events])

  const onScroll = (): void => {
    const el = scroller.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }

  return (
    <div className="feed" ref={scroller} onScroll={onScroll}>
      <div className="feed-inner">
        {events.map((event) => (
          <Message
            key={event.id}
            event={event}
            appearance={config.appearance}
            accent={accentById.get(event.sourceId)}
          />
        ))}
        {events.length === 0 && showHint && <div className="hint">ChatXown · ждём сообщения…</div>}
      </div>
    </div>
  )
}
