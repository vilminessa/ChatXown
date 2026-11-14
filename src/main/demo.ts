import type { ChatEvent } from '../shared/types'

/** Synthetic events for UI work: CHATXOWN_DEMO=1 npm run dev */
export function startDemo(
  emit: (event: ChatEvent) => void,
  getSources: () => Array<{ id: string; channel: string }>
): void {
  const KAPPA = 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0'
  const KEKW =
    'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_9c2b7d1f2a2f4c9bb1e0a0a1d1c1b1a1/default/dark/2.0'

  const build = (index: number, event: Partial<ChatEvent> & { text: string }): ChatEvent => {
    const source = getSources()[0] ?? { id: 'demo', channel: 'vilminessa_' }
    return {
      id: `demo:${index}`,
      platform: 'twitch',
      sourceId: source.id,
      channel: source.channel,
      kind: 'message',
      author: {
        name: 'demo_user',
        displayName: 'DemoUser',
        color: '#4ecdc4',
        userId: `demo-${index}`,
        badges: [
          { id: 'subscriber', url: 'https://static-cdn.jtvnw.net/badges/v1/5d9f2208-5dd8-11e7-8513-2ff4adfae661/1', title: 'Подписчик' }
        ],
        isMod: false,
        isBroadcaster: false
      },
      fragments: [{ type: 'text', text: event.text }],
      ts: Date.now(),
      ...event
    } as ChatEvent
  }

  const events: ChatEvent[] = [
    build(1, {
      text: 'привет чат',
      fragments: [
        { type: 'text', text: 'привет чат ' },
        { type: 'emote', url: KAPPA, alt: 'Kappa' },
        { type: 'text', text: ' ' },
        { type: 'emote', url: KAPPA, alt: 'Kappa' }
      ]
    }),
    build(2, {
      text: 'это проверка эмоутов',
      author: {
        name: 'vilminessa_',
        displayName: 'vilminessa_',
        color: '#ff5b5b',
        userId: '248254125',
        badges: [
          { id: 'broadcaster', url: 'https://static-cdn.jtvnw.net/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/1', title: 'Стример' }
        ],
        isMod: true,
        isBroadcaster: true
      },
      fragments: [
        { type: 'text', text: 'это проверка эмоутов ' },
        { type: 'emote', url: KEKW, alt: 'KEKW' }
      ]
    }),
    build(3, {
      kind: 'sub',
      text: 'Molodoy подписался на 6 месяцев (Tier 1)',
      author: {
        name: 'molodoy',
        displayName: 'Molodoy',
        color: '#7bd88f',
        badges: [],
        isMod: false,
        isBroadcaster: false
      }
    }),
    build(4, {
      kind: 'raid',
      text: 'Нас рейдят: 1337 зрителей от StreamerName!',
      author: { name: 'streame', displayName: 'StreamerName', color: '#ffb347', badges: [], isMod: false, isBroadcaster: false }
    }),
    build(5, {
      kind: 'cheer',
      amount: '1 000 bits',
      text: 'заносим на пиво'
    })
  ]

  let index = 0
  const tick = (): void => {
    if (index >= events.length) return
    emit({ ...events[index], id: `demo:${Date.now()}:${index}`, ts: Date.now() })
    index += 1
    setTimeout(tick, 900)
  }
  setTimeout(tick, 1200)
}
