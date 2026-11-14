import assert from 'node:assert/strict'
import {
  applyWordEmotes,
  buildFragments,
  colorFromName,
  parseBadges,
  parseIrcLine
} from '../src/main/chat/twitch/parser'
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

console.log('✓ parser tests passed')
