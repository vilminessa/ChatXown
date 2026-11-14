import assert from 'node:assert/strict'
import {
  applyWordEmotes,
  buildFragments,
  colorFromName,
  parseBadges,
  parseIrcLine
} from '../src/main/chat/twitch/parser'
import { mapYouTubeAction, mapYouTubeClear } from '../src/main/chat/youtube/map'
import { parseSourceInput } from '../src/shared/sources'
import type { EmoteDef, Fragment } from '../src/shared/types'

/* ------------------------------ IRC parsing ------------------------------ */

const roomState = parseIrcLine(
  '@emote-only=0;followers-only=-1;r9k=0;room-id=248254125;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #vilminessa_'
)
assert.ok(roomState)
assert.equal(roomState.command, 'ROOMSTATE')
assert.equal(roomState.tags['room-id'], '248254125')
assert.deepEqual(roomState.params, ['#vilminessa_'])

const privmsg = parseIrcLine(
  '@badge-info=;badges=broadcaster/1,subscriber/3;color=#1E90FF;display-name=Вася;emotes=25:6-10;id=abc-123;mod=0;room-id=248254125;tmi-sent-ts=1690000000000;user-id=42 :nick!nick@nick.tmi.twitch.tv PRIVMSG #vilminessa_ :привет Kappa мир'
)
assert.ok(privmsg)
assert.equal(privmsg.command, 'PRIVMSG')
assert.equal(privmsg.tags['display-name'], 'Вася')
assert.equal(privmsg.tags['user-id'], '42')
assert.equal(privmsg.params[0], '#vilminessa_')
assert.equal(privmsg.params[1], 'привет Kappa мир')

// escaped tag values
const escaped = parseIrcLine(
  '@system-msg=Вася\\sподарил\\s5\\sподписок;login=vasya :tmi.twitch.tv USERNOTICE #chan :спасибо'
)
assert.ok(escaped)
assert.equal(escaped.tags['system-msg'], 'Вася подарил 5 подписок')
assert.equal(escaped.params[1], 'спасибо')

// ping
const ping = parseIrcLine('PING :tmi.twitch.tv')
assert.ok(ping)
assert.equal(ping.command, 'PING')
assert.deepEqual(ping.params, ['tmi.twitch.tv'])

// garbage
assert.equal(parseIrcLine(''), null)

/* ------------------------------- fragments ------------------------------- */

const fragments = buildFragments('привет Kappa мир', '25:7-11')
assert.deepEqual(fragments, [
  { type: 'text', text: 'привет ' },
  { type: 'emote', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', alt: 'Kappa' },
  { type: 'text', text: ' мир' }
])

// ranges are code points: emoji must not shift the emote range
const withEmoji = buildFragments('😀 Kappa test', '25:2-6')
assert.deepEqual(withEmoji, [
  { type: 'text', text: '😀 ' },
  { type: 'emote', url: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0', alt: 'Kappa' },
  { type: 'text', text: ' test' }
])

// two emotes back to back
const double = buildFragments('Kappa Kappa', '25:0-4,6-10')
assert.equal(double.length, 3)
assert.equal(double[0].type, 'emote')
assert.equal(double[1].type, 'text')
assert.equal(double[2].type, 'emote')

// no emotes tag
assert.deepEqual(buildFragments('hello', undefined), [{ type: 'text', text: 'hello' }])

/* ----------------------------- word emotes ------------------------------ */

const thirdParty = new Map<string, EmoteDef>([
  ['pepeD', { name: 'pepeD', url: 'https://cdn.example/pepeD.webp' }]
])
const merged: Fragment[] = applyWordEmotes(
  [{ type: 'text', text: 'ну pepeD и Kappa' }],
  thirdParty
)
assert.deepEqual(merged, [
  { type: 'text', text: 'ну ' },
  { type: 'emote', url: 'https://cdn.example/pepeD.webp', alt: 'pepeD' },
  { type: 'text', text: ' и Kappa' }
])

/* ------------------------------- badges -------------------------------- */

const badges = parseBadges('broadcaster/1,subscriber/12')
assert.equal(badges.length, 2)
assert.equal(badges[0].id, 'broadcaster')
assert.equal(badges[0].url, 'https://static-cdn.jtvnw.net/badges/v1/broadcaster/1/1')
assert.equal(badges[0].title, 'Стример')

/* -------------------------------- colors -------------------------------- */

assert.match(colorFromName('vilminessa_'), /^#[0-9a-f]{6}$/i)
assert.equal(colorFromName('vilminessa_'), colorFromName('vilminessa_'))

/* ------------------------------ source input ----------------------------- */

const twitchUrl = parseSourceInput('https://www.twitch.tv/vilminessa_?foo=1')
assert.equal(twitchUrl.platform, 'twitch')
assert.equal(twitchUrl.channel, 'vilminessa_')
assert.equal(twitchUrl.error, undefined)

assert.equal(parseSourceInput('@LofiGirl').channel, '@LofiGirl')
assert.equal(parseSourceInput('https://youtube.com/@LofiGirl/live').channel, '@LofiGirl')
assert.equal(parseSourceInput('https://www.youtube.com/watch?v=1b30TSLDv0Q&t=10').channel, '1b30TSLDv0Q')
assert.equal(parseSourceInput('https://youtu.be/1b30TSLDv0Q').channel, '1b30TSLDv0Q')
assert.equal(parseSourceInput('https://www.youtube.com/live/1b30TSLDv0Q').channel, '1b30TSLDv0Q')
assert.equal(parseSourceInput('https://www.youtube.com/shorts/1b30TSLDv0Q').channel, '1b30TSLDv0Q')
assert.equal(
  parseSourceInput('https://www.youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow').channel,
  'UCSJ4gkVC6NrvII8umztf0Ow'
)
assert.equal(parseSourceInput('UCSJ4gkVC6NrvII8umztf0Ow').platform, 'youtube')
assert.equal(parseSourceInput('1b30TSLDv0Q', 'youtube').channel, '1b30TSLDv0Q')
assert.equal(
  parseSourceInput('https://youtube.com/c/LofiGirl').channel,
  'https://youtube.com/c/LofiGirl'
)
assert.ok(parseSourceInput('https://example.com/nope', 'youtube').error)

/* ------------------------------ youtube map ------------------------------ */

const ytContext = { sourceId: 'yt1', channel: '@LofiGirl', channelId: 'UCstreamer' }

const textAction = {
  type: 'AddChatItemAction',
  item: {
    type: 'LiveChatTextMessage',
    id: 'msg-1',
    timestamp: 1_700_000_000_000,
    author: {
      name: '@ModUser',
      id: 'UCmod',
      badges: [
        {
          type: 'LiveChatAuthorBadge',
          icon_type: 'MODERATOR',
          tooltip: 'Moderator',
          custom_thumbnail: []
        }
      ]
    },
    message: {
      runs: [
        { text: 'hi ' },
        {
          text: 'Kappa',
          emoji: {
            image: [
              { url: 'https://example/1x.png', width: 24, height: 24 },
              { url: 'https://example/2x.png', width: 48, height: 48 }
            ],
            shortcuts: ['Kappa']
          }
        }
      ]
    }
  }
}

const textEvents = mapYouTubeAction(textAction, ytContext)
assert.equal(textEvents.length, 1)
const textEvent = textEvents[0]
assert.equal(textEvent.platform, 'youtube')
assert.equal(textEvent.sourceId, 'yt1')
assert.equal(textEvent.id, 'yt1:msg-1')
assert.equal(textEvent.kind, 'message')
assert.equal(textEvent.author.displayName, 'ModUser')
assert.equal(textEvent.author.userId, 'UCmod')
assert.equal(textEvent.author.isMod, true)
assert.equal(textEvent.author.badges[0].label, 'Мод')
assert.equal(textEvent.author.badges[0].url, '')
assert.deepEqual(textEvent.fragments, [
  { type: 'text', text: 'hi ' },
  { type: 'emote', url: 'https://example/2x.png', alt: 'Kappa' }
])
assert.equal(textEvent.text, 'hi Kappa')

const broadcaster = mapYouTubeAction(
  {
    item: {
      type: 'LiveChatTextMessage',
      id: 'msg-2',
      author: { name: '@Streamer', id: 'UCstreamer', badges: [] },
      message: { runs: [{ text: 'hello' }] }
    }
  },
  ytContext
)[0]
assert.equal(broadcaster.author.isBroadcaster, true)

const cheer = mapYouTubeAction(
  {
    item: {
      type: 'LiveChatPaidMessage',
      id: 'paid-1',
      author: { name: '@Donor', id: 'UCdonor', badges: [] },
      message: { runs: [{ text: 'take my money' }] },
      purchase_amount: '$5.00'
    }
  },
  ytContext
)[0]
assert.equal(cheer.kind, 'cheer')
assert.equal(cheer.amount, '$5.00')

const membership = mapYouTubeAction(
  {
    item: {
      type: 'LiveChatMembershipItem',
      id: 'member-1',
      author: { name: '@Newbie', id: 'UCnewbie', badges: [] },
      header_primary_text: { toString: () => 'Newbie became a member' },
      header_subtext: { toString: () => '3 months' },
      message: { toString: () => 'hi all' }
    }
  },
  ytContext
)[0]
assert.equal(membership.kind, 'sub')
assert.equal(membership.text, 'Newbie became a member 3 months hi all')

const gift = mapYouTubeAction(
  {
    item: {
      type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
      id: 'gift-1',
      author_external_channel_id: 'UCgifter',
      header: {
        author_name: { toString: () => '@Gifter' },
        author_badges: [],
        primary_text: { toString: () => 'Gifter gifted 5 memberships' }
      }
    }
  },
  ytContext
)[0]
assert.equal(gift.kind, 'gift')
assert.equal(gift.author.displayName, 'Gifter')
assert.equal(gift.text, 'Gifter gifted 5 memberships')

assert.deepEqual(
  mapYouTubeClear({ type: 'MarkChatItemAsDeletedAction', target_item_id: 'abc' }, 'yt1'),
  { sourceId: 'yt1', ids: ['yt1:abc'] }
)
assert.deepEqual(
  mapYouTubeClear({ type: 'RemoveChatItemByAuthorAction', external_channel_id: 'UCbad' }, 'yt1'),
  { sourceId: 'yt1', userId: 'UCbad' }
)
assert.equal(mapYouTubeClear({ type: 'UpdateLiveChatPollAction' }, 'yt1'), null)

console.log('✓ parser tests passed')
