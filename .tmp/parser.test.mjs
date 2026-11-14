// tests/parser.test.ts
import assert from "node:assert/strict";

// src/main/chat/twitch/parser.ts
function unescapeTagValue(value) {
  return value.replace(/\\(.)/g, (_match, char) => {
    switch (char) {
      case "s":
        return " ";
      case ":":
        return ";";
      case "r":
        return "\r";
      case "n":
        return "\n";
      case "\\":
        return "\\";
      default:
        return char;
    }
  });
}
function parseIrcLine(line) {
  let rest = line.replace(/[\r\n]+$/, "");
  if (!rest) return null;
  const tags = {};
  if (rest.startsWith("@")) {
    const end = rest.indexOf(" ");
    if (end === -1) return null;
    for (const pair of rest.slice(1, end).split(";")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq === -1) tags[pair] = "";
      else tags[pair.slice(0, eq)] = unescapeTagValue(pair.slice(eq + 1));
    }
    rest = rest.slice(end + 1);
  }
  let prefix;
  if (rest.startsWith(":")) {
    const end = rest.indexOf(" ");
    if (end === -1) {
      return { tags, prefix: rest.slice(1), command: "", params: [] };
    }
    prefix = rest.slice(1, end);
    rest = rest.slice(end + 1);
  }
  const params = [];
  const firstSpace = rest.indexOf(" ");
  let command = rest;
  if (firstSpace !== -1) {
    command = rest.slice(0, firstSpace);
    rest = rest.slice(firstSpace + 1);
  } else {
    rest = "";
  }
  while (rest.length > 0) {
    if (rest.startsWith(":")) {
      params.push(rest.slice(1));
      break;
    }
    const sp = rest.indexOf(" ");
    if (sp === -1) {
      params.push(rest);
      break;
    }
    params.push(rest.slice(0, sp));
    rest = rest.slice(sp + 1).replace(/^ +/, "");
  }
  return { tags, prefix, command: command.toUpperCase(), params };
}
function twitchEmoteUrl(id) {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;
}
function badgeUrl(setId, version) {
  return `https://static-cdn.jtvnw.net/badges/v1/${setId}/${version}/1`;
}
var BADGE_TITLES = {
  broadcaster: "\u0421\u0442\u0440\u0438\u043C\u0435\u0440",
  moderator: "\u041C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440",
  vip: "VIP",
  subscriber: "\u041F\u043E\u0434\u043F\u0438\u0441\u0447\u0438\u043A",
  founder: "\u041E\u0441\u043D\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043A\u0430\u043D\u0430\u043B\u0430",
  prime: "Prime",
  premium: "Turbo",
  turbo: "Turbo",
  staff: "Twitch Staff",
  admin: "Twitch Admin",
  global_mod: "Global Moderator",
  partner: "Partner",
  bits: "Bits",
  "bits-leader": "\u041B\u0438\u0434\u0435\u0440 Bits",
  "sub-gift-leader": "\u041B\u0438\u0434\u0435\u0440 \u043F\u043E\u0434\u0430\u0440\u043A\u043E\u0432",
  "sub-gifter": "\u0414\u0430\u0440\u0438\u0442\u0435\u043B\u044C \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A",
  "no_audio": "\u0411\u0435\u0437 \u0437\u0432\u0443\u043A\u0430",
  "no_video": "\u0411\u0435\u0437 \u0432\u0438\u0434\u0435\u043E",
  predictions: "\u041F\u0440\u043E\u0433\u043D\u043E\u0437\u044B"
};
function parseBadges(raw) {
  if (!raw) return [];
  const out = [];
  for (const item of raw.split(",")) {
    if (!item) continue;
    const slash = item.indexOf("/");
    const setId = slash === -1 ? item : item.slice(0, slash);
    const version = slash === -1 ? "1" : item.slice(slash + 1);
    if (!setId) continue;
    out.push({ id: setId, url: badgeUrl(setId, version), title: BADGE_TITLES[setId] });
  }
  return out;
}
var USER_COLORS = [
  "#ff5b5b",
  "#ff8f40",
  "#ffd23f",
  "#7bd88f",
  "#3ddc97",
  "#4ecdc4",
  "#4aa8ff",
  "#7b8cff",
  "#b388ff",
  "#ff6bd6"
];
function colorFromName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = hash * 31 + name.charCodeAt(i) | 0;
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}
function buildFragments(text, emotesTag) {
  if (!text) return [];
  const codePoints = Array.from(text);
  const slots = new Array(
    codePoints.length
  ).fill(null);
  let run = 0;
  if (emotesTag) {
    for (const chunk of emotesTag.split("/")) {
      if (!chunk) continue;
      const colon = chunk.indexOf(":");
      if (colon === -1) continue;
      const id = chunk.slice(0, colon);
      const ranges = chunk.slice(colon + 1);
      if (!id || !ranges) continue;
      const url = twitchEmoteUrl(id);
      for (const range of ranges.split(",")) {
        const dash = range.indexOf("-");
        if (dash === -1) continue;
        const start = Number(range.slice(0, dash));
        const end = Number(range.slice(dash + 1));
        if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
        const last = Math.min(end, codePoints.length - 1);
        if (start < 0 || start > last) continue;
        const alt = codePoints.slice(start, last + 1).join("");
        run += 1;
        for (let i = start; i <= last; i += 1) slots[i] = { url, alt, run };
      }
    }
  }
  const out = [];
  let buffer = "";
  let lastRun = -1;
  for (let i = 0; i < codePoints.length; i += 1) {
    const slot = slots[i];
    if (slot) {
      if (buffer) {
        out.push({ type: "text", text: buffer });
        buffer = "";
      }
      if (slot.run !== lastRun) {
        out.push({ type: "emote", url: slot.url, alt: slot.alt });
        lastRun = slot.run;
      }
    } else {
      buffer += codePoints[i];
      lastRun = -1;
    }
  }
  if (buffer) out.push({ type: "text", text: buffer });
  return out;
}
function applyWordEmotes(fragments2, emotes) {
  if (emotes.size === 0) return fragments2;
  const out = [];
  const pushText = (text) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === "text") last.text += text;
    else out.push({ type: "text", text });
  };
  for (const fragment of fragments2) {
    if (fragment.type !== "text") {
      out.push(fragment);
      continue;
    }
    for (const part of fragment.text.split(/(\s+)/)) {
      if (!part) continue;
      const emote = emotes.get(part);
      if (emote) out.push({ type: "emote", url: emote.url, alt: emote.name });
      else pushText(part);
    }
  }
  return out;
}

// tests/parser.test.ts
var roomState = parseIrcLine(
  "@emote-only=0;followers-only=-1;r9k=0;room-id=248254125;slow=0;subs-only=0 :tmi.twitch.tv ROOMSTATE #vilminessa_"
);
assert.ok(roomState);
assert.equal(roomState.command, "ROOMSTATE");
assert.equal(roomState.tags["room-id"], "248254125");
assert.deepEqual(roomState.params, ["#vilminessa_"]);
var privmsg = parseIrcLine(
  "@badge-info=;badges=broadcaster/1,subscriber/3;color=#1E90FF;display-name=\u0412\u0430\u0441\u044F;emotes=25:6-10;id=abc-123;mod=0;room-id=248254125;tmi-sent-ts=1690000000000;user-id=42 :nick!nick@nick.tmi.twitch.tv PRIVMSG #vilminessa_ :\u043F\u0440\u0438\u0432\u0435\u0442 Kappa \u043C\u0438\u0440"
);
assert.ok(privmsg);
assert.equal(privmsg.command, "PRIVMSG");
assert.equal(privmsg.tags["display-name"], "\u0412\u0430\u0441\u044F");
assert.equal(privmsg.tags["user-id"], "42");
assert.equal(privmsg.params[0], "#vilminessa_");
assert.equal(privmsg.params[1], "\u043F\u0440\u0438\u0432\u0435\u0442 Kappa \u043C\u0438\u0440");
var escaped = parseIrcLine(
  "@system-msg=\u0412\u0430\u0441\u044F\\s\u043F\u043E\u0434\u0430\u0440\u0438\u043B\\s5\\s\u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A;login=vasya :tmi.twitch.tv USERNOTICE #chan :\u0441\u043F\u0430\u0441\u0438\u0431\u043E"
);
assert.ok(escaped);
assert.equal(escaped.tags["system-msg"], "\u0412\u0430\u0441\u044F \u043F\u043E\u0434\u0430\u0440\u0438\u043B 5 \u043F\u043E\u0434\u043F\u0438\u0441\u043E\u043A");
assert.equal(escaped.params[1], "\u0441\u043F\u0430\u0441\u0438\u0431\u043E");
var ping = parseIrcLine("PING :tmi.twitch.tv");
assert.ok(ping);
assert.equal(ping.command, "PING");
assert.deepEqual(ping.params, ["tmi.twitch.tv"]);
assert.equal(parseIrcLine(""), null);
var fragments = buildFragments("\u043F\u0440\u0438\u0432\u0435\u0442 Kappa \u043C\u0438\u0440", "25:7-11");
assert.deepEqual(fragments, [
  { type: "text", text: "\u043F\u0440\u0438\u0432\u0435\u0442 " },
  { type: "emote", url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0", alt: "Kappa" },
  { type: "text", text: " \u043C\u0438\u0440" }
]);
var withEmoji = buildFragments("\u{1F600} Kappa test", "25:2-6");
assert.deepEqual(withEmoji, [
  { type: "text", text: "\u{1F600} " },
  { type: "emote", url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0", alt: "Kappa" },
  { type: "text", text: " test" }
]);
var double = buildFragments("Kappa Kappa", "25:0-4,6-10");
assert.equal(double.length, 3);
assert.equal(double[0].type, "emote");
assert.equal(double[1].type, "text");
assert.equal(double[2].type, "emote");
assert.deepEqual(buildFragments("hello", void 0), [{ type: "text", text: "hello" }]);
var thirdParty = /* @__PURE__ */ new Map([
  ["pepeD", { name: "pepeD", url: "https://cdn.example/pepeD.webp" }]
]);
var merged = applyWordEmotes(
  [{ type: "text", text: "\u043D\u0443 pepeD \u0438 Kappa" }],
  thirdParty
);
assert.deepEqual(merged, [
  { type: "text", text: "\u043D\u0443 " },
  { type: "emote", url: "https://cdn.example/pepeD.webp", alt: "pepeD" },
  { type: "text", text: " \u0438 Kappa" }
]);
var badges = parseBadges("broadcaster/1,subscriber/12");
assert.equal(badges.length, 2);
assert.equal(badges[0].id, "broadcaster");
assert.equal(badges[0].url, "https://static-cdn.jtvnw.net/badges/v1/broadcaster/1/1");
assert.equal(badges[0].title, "\u0421\u0442\u0440\u0438\u043C\u0435\u0440");
assert.match(colorFromName("vilminessa_"), /^#[0-9a-f]{6}$/i);
assert.equal(colorFromName("vilminessa_"), colorFromName("vilminessa_"));
console.log("\u2713 parser tests passed");
