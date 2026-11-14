# ChatXown

Оверлей чата Twitch поверх других окон Windows. Electron + TypeScript + React.

![status](https://img.shields.io/badge/state-alpha-orange)

## Что уже работает

- **Прозрачное окно поверх всех окон** — frameless, без рамки и тени, не занимает место в таскбаре.
- **Сквозной режим** — клики проходят в игру/приложение под оверлеем. Переключается горячей клавишей, из трея или из настроек.
- **Несколько чатов одновременно** — каждый источник включается/выключается отдельным тумблером, своё имя, цвет и набор эмоутов.
- **Twitch без авторизации** — анонимный IRC по WebSocket (`justinfan`), один коннект на все каналы.
- **Эмоуты**: нативные Twitch + **7TV**, **BTTV**, **FFZ** (канальные и глобальные наборы, кэш на 6 часов).
- **Бейджи, цвета ников, /me, sub/resub/subgift/raid, bits**, удаление сообщений (CLEARMSG/CLEARCHAT).
- **Настройки**: шрифт, прозрачность фона, ширина плашек, лимит сообщений, таймстемпы, бейджи, автоскрытие старых сообщений, фильтры по словам/юзерам.
- **Трей + горячие клавиши**, конфиг в `%APPDATA%\chatxown\config.json`.

## Горячие клавиши

| Комбинация | Действие |
|---|---|
| `Ctrl+Alt+O` | Сквозной режим вкл/выкл (в интерактивном режиме появляется шапка для перетаскивания) |
| `Ctrl+Alt+H` | Скрыть / показать оверлей |
| `Ctrl+Alt+S` | Настройки |

## Ограничения

- Поверх **эксклюзивного fullscreen** оверлей не отображается — это делает только инжект в процесс игры. Используйте borderless / windowed.
- YouTube-чаты — в разработке (следующий этап).
- Модерация (удаление сообщений, таймауты, баны) — следующий этап, требует OAuth-логина Twitch.

## Разработка

```bash
npm install
npm run dev          # запуск с HMR
npm run build        # сборка в out/
npm test             # юнит-тесты парсера IRC
npm run typecheck    # tsc по main и renderer
```

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
src/preload/        contextBridge API
src/renderer/       overlay (лента) и settings (настройки)
src/shared/         общие типы
scripts/            тесты, генератор иконки, probe IRC
```

## Технические заметки

- Twitch: `wss://irc-ws.chat.twitch.tv:443`, `CAP REQ :twitch.tv/tags twitch.tv/commands`, анонимный `justinfan*`.
- Эмоуты: `7tv.io/v3`, `api.betterttv.net/3`, `api.frankerfacez.com/v1`. Приоритет при коллизии имён: 7TV → BTTV → FFZ → нативные.
- Окно: `transparent`, `focusable: false`, `setAlwaysOnTop(true, 'screen-saver')`, `setIgnoreMouseEvents(..., { forward: true })`.

## Репозиторий

http://vilmpc:3000/Vilminessa/ChatXown
