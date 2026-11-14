// Probe: finds a live YouTube stream and prints chat items for ~20s.
// Usage: node scripts/probe-youtube.mjs [videoIdOrUrl]
import { Innertube } from 'youtubei.js'

const arg = process.argv[2]

const yt = await Innertube.create({ retrieve_player: false })
console.log('[yt] session ready')

let videoId = arg

if (!videoId) {
  const search = await yt.search('live stream', { type: 'video', features: ['live'] })
  const first = search.videos[0]
  if (!first) {
    console.log('[yt] no live results')
    process.exit(1)
  }
  videoId = first.video_id
  console.log('[yt] picked', videoId, '|', first.title?.toString(), '|', first.author?.name)
} else if (/^https?:/.test(videoId)) {
  const endpoint = await yt.resolveURL(videoId)
  console.log('[yt] resolved payload', JSON.stringify(endpoint.payload).slice(0, 600))
  videoId =
    endpoint.payload?.watchEndpoint?.videoId ??
    endpoint.payload?.reelWatchEndpoint?.videoId ??
    videoId
}

const info = await yt.getInfo(videoId)
console.log('[yt] basic:', JSON.stringify(info.basic_info).slice(0, 500))
console.log('[yt] is_live:', info.basic_info.is_live, 'livechat present:', Boolean(info.livechat))

const chat = info.getLiveChat()
chat.on('start', (data) => console.log('[chat] start, actions:', data?.actions?.length ?? '?'))
chat.on('error', (error) => console.log('[chat] error', error?.message ?? error))
chat.on('end', () => console.log('[chat] end'))
chat.on('chat-update', (action) => {
  const type = action?.constructor?.name ?? String(action?.type)
  const item = action?.item
  if (!item) {
    console.log('[chat]', type, JSON.stringify({ target: action?.target_item_id, channel: action?.external_channel_id }))
    return
  }
  const summary = {
    type: item.constructor?.name ?? String(item.type),
    id: item.id,
    author: item.author?.name,
    channelId: item.author?.id,
    text: item.message?.toString?.(),
    amount: item.purchase_amount,
    header: item.header_primary_text?.toString?.(),
    subtext: item.header_subtext?.toString?.(),
    badges: item.author?.badges?.map?.((b) => b?.metadata?.badge_id ?? b?.constructor?.name) ?? []
  }
  console.log('[chat]', JSON.stringify(summary).slice(0, 500))
})

chat.start()

setTimeout(() => {
  console.log('[chat] stopping')
  chat.stop()
  process.exit(0)
}, 25_000)
