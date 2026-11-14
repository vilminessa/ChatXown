# ChatXown

Оверлей чата Twitch и YouTube поверх других окон Windows. Electron + TypeScript + React.

![status](https://img.shields.io/badge/state-alpha-orange)

## Что уже работает

- **Прозрачное окно поверх всех окон** — frameless, без рамки и тени, не занимает место в таскбаре.
- **Сквозной режим** — клики проходят в игру/приложение под оверлеем. Переключается горячей клавишей, из трея или из настроек.
- **Несколько чатов одновременно** — Twitch и YouTube вперемешку, каждый источник включается/выключается отдельным тумблером, своё имя, цвет и набор эмоутов.
- **Twitch без авторизации** — анонимный IRC по WebSocket (`justinfan`), один коннект на все каналы.
- **YouTube** — живой чат через `youtubei.js`: `@handle`, ID канала, ссылка на канал или конкретный эфир. Канал перепроверяется, когда эфир заканчивается или ещё не начался.
- **Эмоуты Twitch**: нативные + **7TV**, **BTTV**, **FFZ** (канальные и глобальные наборы, кэш на 6 часов). На YouTube — нативные эмодзи/эмоуты канала.
- **Бейджи, цвета ников, /me, sub/resub/subgift/raid, bits**, удаление сообщений (CLEARMSG/CLEARCHAT). Для YouTube — бейджи (автор, мод, участник, ✓) и очистка сообщений/по автору.
- **Модерация Twitch** — удаление сообщения, таймаут на 10 минут и бан прямо из оверлея (Helix API, OAuth Device Code Flow).
- **Настройки**: шрифт, прозрачность фона, ширина плашек, лимит сообщений, таймстемпы, бейджи, автоскрытие старых сообщений, фильтры по словам/юзерам.
- **Трей + горячие клавиши**, конфиг в `%APPDATA%\chatxown\config.json`.

## YouTube

Добавьте источник и вставьте одно из:

- `@handle` — например, `@LofiGirl`;
- ID канала вида `UC…`;
- ссылку на канал (`youtube.com/@LofiGirl`, `youtube.com/channel/UC…`, legacy `/c/…` и `/user/…`);
- ссылку на конкретный эфир или видео (`youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/live/…`).

Если указан канал, ChatXown сам находит текущий live-эфир и подключается к его чату. Когда эфир заканчивается, источник переходит в состояние **не в эфире** и периодически проверяет канал снова. Для видео-ID проверяется, что эфир ещё идёт и чат включён.

Ограничения YouTube: сторонние наборы 7TV/BTTV/FFZ не поддерживают YouTube, поэтому доступны только нативные эмодзи и эмоуты канала. Модерация пока реализована только для Twitch.

## Модерация

1. Создайте приложение на <https://dev.twitch.tv/console/apps>: тип **Public**, OAuth Redirect URL — `http://localhost`.
2. В настройках ChatXown откройте **Аккаунт Twitch**, вставьте **Client ID** и нажмите **Войти через Twitch**.
3. Введите показанный код на `twitch.tv/activate` и подтвердите доступ.
4. Переключитесь в интерактивный режим оверлея (`Ctrl+Alt+O`) — при наведении на сообщение появятся кнопки `⌫` (удалить), `10м` (таймаут) и `Бан` (второй клик подтверждает).

Токены хранятся зашифрованными через `safeStorage` в `%APPDATA%\chatxown\auth.json`. Нужны разрешения `moderator:manage:banned_users` и `moderator:manage:chat_messages`; вы должны быть модератором или владельцем канала.

## Горячие клавиши

| Комбинация | Действие |
|---|---|
| `Ctrl+Alt+O` | Сквозной режим вкл/выкл (в интерактивном режиме появляется шапка для перетаскивания и кнопки модерации) |
| `Ctrl+Alt+H` | Скрыть / показать оверлей |
| `Ctrl+Alt+S` | Настройки |

## Ограничения

- Поверх **эксклюзивного fullscreen** оверлей не отображается — это делает только инжект в процесс игры. Используйте borderless / windowed.
- YouTube: только нативные эмоуты, модерация недоступна; при отключённом чате источник показывает ошибку.
- Кнопки модерации работают только в интерактивном режиме (когда выключен сквозной режим), потому что в сквозном режиме клики уходят в игру.

## Разработка

```bash
npm install
npm run dev          # запуск с HMR
npm run build        # сборка в out/
npm test             # юнит-тесты парсера, источников и маппинга YouTube
npm run typecheck    # tsc по main и renderer
```

Windows-сборка:

```bash
npm run dist         # NSIS-установщик + portable exe в release/
npm run dist:dir     # распакованная сборка в release/win-unpacked
```

Готовые exe публикуются автоматически: создайте и запушьте тег `v0.1.0` — GitHub Actions соберёт установщик и portable-версию и приложит их к релизу.

Полезные переменные окружения:

```bash
CHATXOWN_DEBUG=1        # логировать события чата и статусы соединений в stdout
CHATXOWN_DEMO=1         # синтетические сообщения для проверки вёрстки
CHATXOWN_CAPTURE=path.png  # снять скриншот окна через 9 секунд
CHATXOWN_OPEN_SETTINGS=1   # открыть окно настроек при старте
```

### Структура

```
src/main/           главный процесс (окна, трей, хоткеи, конфиг)
src/main/chat/      менеджер источников
  twitch/           IRC-клиент, парсер, маппинг событий
  youtube/          резолв эфира, live chat клиент, маппинг событий
src/main/twitch/    OAuth (device flow), Helix API, модерация
src/preload/        contextBridge API
src/renderer/       overlay (лента) и settings (настройки)
src/shared/         общие типы и разбор входных ссылок
scripts/            тесты, генератор иконки, probe IRC/YouTube, сборка youtubei.js
.github/workflows/  CI-сборка exe на тегах v*
```

## Технические заметки

- Twitch: `wss://irc-ws.chat.twitch.tv:443`, `CAP REQ :twitch.tv/tags twitch.tv/commands`, анонимный `justinfan*`.
- Эмоуты: `7tv.io/v3`, `api.betterttv.net/3`, `api.frankerfacez.com/v1`. Приоритет при коллизии имён: 7TV → BTTV → FFZ → нативные.
- YouTube: `youtubei.js` (ESM, загружается динамическим import), `getLiveStreams()` для поиска эфира, `getInfo().getLiveChat()` для чата; неизвестные узлы парсера игнорируются. Для упакованной сборки библиотека собирается esbuild в один `resources/youtube.mjs`, чтобы не зависеть от ESM/asar.
- Сборка: `electron-builder` (NSIS + portable), иконки из `resources/`, `resources/resources` внутри пакета.
- Модерация: Helix `DELETE /moderation/chat`, `POST /moderation/bans`, `DELETE /moderation/banned`; авторизация — Device Code Flow без client secret.
- Окно: `transparent`, `focusable: false`, `setAlwaysOnTop(true, 'screen-saver')`, `setIgnoreMouseEvents(..., { forward: true })`.

## Репозиторий

http://vilmpc:3000/Vilminessa/ChatXown
