// Quick connectivity probe for anonymous Twitch IRC.
// Usage: node scripts/probe-twitch.mjs [channel]
import WebSocket from 'ws'

const channel = (process.argv[2] || 'vilminessa_').toLowerCase()
const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443')
const started = Date.now()
let messages = 0

const timer = setTimeout(() => {
  console.log(`\n[probe] done in ${Date.now() - started}ms, chat messages: ${messages}`)
  ws.close()
  process.exit(0)
}, 20_000)

ws.on('open', () => {
  console.log('[probe] connected')
  ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n')
  ws.send('PASS SCHMOOPIIE\r\n')
  ws.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}\r\n`)
  ws.send(`JOIN #${channel}\r\n`)
})

ws.on('message', (data) => {
  for (const line of data.toString().split('\r\n')) {
    if (!line) continue
    if (line.startsWith('PING')) {
      ws.send('PONG :tmi.twitch.tv\r\n')
      continue
    }
    if (line.includes('PRIVMSG')) {
      messages += 1
      const tagsPart = line.startsWith('@') ? line.slice(1, line.indexOf(' ')) : ''
      const tags = Object.fromEntries(
        tagsPart
          .split(';')
          .filter(Boolean)
          .map((pair) => {
            const eq = pair.indexOf('=')
            return [pair.slice(0, eq), pair.slice(eq + 1)]
          })
      )
      const text = line.slice(line.indexOf('PRIVMSG')).replace(/^PRIVMSG #\S+ :/, '')
      console.log(
        `[msg] ${tags['display-name'] || tags['login']} (${tags['user-id']}) room=${tags['room-id']} ` +
          `emotes=${tags['emotes'] || '-'} :: ${text.slice(0, 120)}`
      )
      continue
    }
    if (/JOIN|ROOMSTATE|NOTICE|RECONNECT|001|CLEAR/.test(line)) {
      console.log('[irc]', line.slice(0, 220))
    }
  }
  if (messages >= 15) {
    clearTimeout(timer)
    console.log(`\n[probe] got ${messages} messages, closing`)
    ws.close()
    process.exit(0)
  }
})

ws.on('error', (error) => {
  console.error('[probe] error', error.message)
  process.exit(1)
})

ws.on('close', () => {
  console.log('[probe] closed')
})
