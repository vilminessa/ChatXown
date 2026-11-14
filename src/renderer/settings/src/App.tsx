import { useEffect, useState } from 'react'
import type { AppConfig, Platform, SourceConfig, SourceStatus } from '../../../shared/types'

const api = window.chatxown

const STATE_LABELS: Record<SourceStatus['state'], string> = {
  idle: 'выключен',
  connecting: 'подключается',
  connected: 'в чате',
  error: 'ошибка'
}

export function App(): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [statuses, setStatuses] = useState<SourceStatus[]>([])
  const [input, setInput] = useState('')
  const [platform, setPlatform] = useState<'auto' | Platform>('auto')
  const [addError, setAddError] = useState('')

  useEffect(() => {
    void api.getState().then((state) => {
      setConfig(state.config)
      setStatuses(state.statuses)
    })
    const offConfig = api.onConfig((next) => setConfig(next))
    const offStatus = api.onStatus((next) => setStatuses(next))
    return () => {
      offConfig()
      offStatus()
    }
  }, [])

  if (!config) return <div className="loading">Загрузка…</div>

  const patch = (p: unknown): void => {
    void api.patchConfig(p).then(setConfig)
  }

  const addSource = async (): Promise<void> => {
    setAddError('')
    const result = await api.addSource(input, platform === 'auto' ? undefined : platform)
    if (!result.ok) {
      setAddError(result.error ?? 'Не удалось добавить источник')
      return
    }
    setInput('')
    if (result.config) setConfig(result.config)
  }

  const updateSource = async (id: string, p: Partial<SourceConfig>): Promise<void> => {
    const result = await api.updateSource(id, p)
    if (result.config) setConfig(result.config)
    if (!result.ok && result.error) setAddError(result.error)
  }

  const removeSource = async (source: SourceConfig): Promise<void> => {
    if (!confirm(`Удалить ${source.platform === 'twitch' ? 'Twitch' : 'YouTube'}-канал «${source.label}»?`)) {
      return
    }
    setConfig(await api.removeSource(source.id))
  }

  const statusFor = (id: string): SourceStatus | undefined => statuses.find((s) => s.id === id)

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>ChatXown</h1>
          <p className="sub">Оверлей чата Twitch · скоро YouTube</p>
        </div>
        <button className="ghost" onClick={() => void api.overlayAction('show')}>
          Показать оверлей
        </button>
      </header>

      <main>
        <section className="card">
          <div className="card-head">
            <h2>Источники</h2>
            <span className="muted">{config.sources.length} шт.</span>
          </div>

          <div className="add-row">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void addSource()
              }}
              placeholder="twitch.tv/channel или название канала"
            />
            <select value={platform} onChange={(event) => setPlatform(event.target.value as 'auto' | Platform)}>
              <option value="auto">Авто</option>
              <option value="twitch">Twitch</option>
              <option value="youtube">YouTube</option>
            </select>
            <button className="primary" onClick={() => void addSource()}>
              Добавить
            </button>
          </div>
          {addError && <p className="error">{addError}</p>}

          <div className="sources">
            {config.sources.length === 0 && (
              <p className="muted empty">Пока нет источников. Добавьте канал выше.</p>
            )}
            {config.sources.map((source) => {
              const status = statusFor(source.id)
              return (
                <div className={`source ${source.enabled ? '' : 'disabled'}`} key={source.id}>
                  <div className="source-main">
                    <label className="switch" title={source.enabled ? 'Выключить' : 'Включить'}>
                      <input
                        type="checkbox"
                        checked={source.enabled}
                        onChange={(event) => void updateSource(source.id, { enabled: event.target.checked })}
                      />
                      <span className="slider" />
                    </label>

                    <span className={`chip chip-${source.platform}`}>
                      {source.platform === 'twitch' ? 'TWITCH' : 'YOUTUBE'}
                    </span>

                    <input
                      className="channel"
                      defaultValue={source.channel}
                      key={`${source.id}-${source.channel}`}
                      onBlur={(event) => {
                        const value = event.target.value.trim()
                        if (value && value !== source.channel) void updateSource(source.id, { channel: value })
                      }}
                    />

                    <input
                      className="label"
                      defaultValue={source.label}
                      key={`${source.id}-label`}
                      onBlur={(event) => {
                        const value = event.target.value.trim()
                        if (value && value !== source.label) void updateSource(source.id, { label: value })
                      }}
                    />

                    <span
                      className={`status status-${status?.state ?? 'idle'}`}
                      title={status?.detail ?? ''}
                    >
                      {STATE_LABELS[status?.state ?? 'idle']}
                    </span>

                    <input
                      type="color"
                      className="color"
                      value={source.accent}
                      onChange={(event) => void updateSource(source.id, { accent: event.target.value })}
                      title="Цвет источника"
                    />

                    <button className="danger ghost" onClick={() => void removeSource(source)}>
                      Удалить
                    </button>
                  </div>

                  <div className="source-extra">
                    <span className="muted">Эмоуты:</span>
                    {(['sevenTv', 'bttv', 'ffz'] as const).map((key) => (
                      <label key={key} className="check">
                        <input
                          type="checkbox"
                          checked={source.emotes[key]}
                          onChange={(event) =>
                            void updateSource(source.id, {
                              emotes: { ...source.emotes, [key]: event.target.checked }
                            })
                          }
                        />
                        {key === 'sevenTv' ? '7TV' : key.toUpperCase()}
                      </label>
                    ))}

                    <span className="muted">Скрыть слова/юзеров:</span>
                    <input
                      className="filter"
                      defaultValue={source.filter.hideWords.join(', ')}
                      placeholder="слово1, слово2"
                      onBlur={(event) =>
                        void updateSource(source.id, {
                          filter: {
                            ...source.filter,
                            hideWords: event.target.value
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean)
                          }
                        })
                      }
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Внешний вид</h2>
          </div>
          <div className="grid">
            <label className="field">
              <span>Размер шрифта: {config.appearance.fontSize}px</span>
              <input
                type="range"
                min={10}
                max={32}
                value={config.appearance.fontSize}
                onChange={(event) => patch({ appearance: { fontSize: Number(event.target.value) } })}
              />
            </label>

            <label className="field">
              <span>Фон сообщений: {Math.round(config.appearance.opacity * 100)}%</span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(config.appearance.opacity * 100)}
                onChange={(event) =>
                  patch({ appearance: { opacity: Number(event.target.value) / 100 } })
                }
              />
            </label>

            <label className="field">
              <span>Ширина плашки: {config.appearance.maxBubbleWidth}px</span>
              <input
                type="range"
                min={160}
                max={900}
                step={10}
                value={config.appearance.maxBubbleWidth}
                onChange={(event) =>
                  patch({ appearance: { maxBubbleWidth: Number(event.target.value) } })
                }
              />
            </label>

            <label className="field">
              <span>Хранить сообщений: {config.appearance.maxMessages}</span>
              <input
                type="range"
                min={20}
                max={500}
                step={10}
                value={config.appearance.maxMessages}
                onChange={(event) =>
                  patch({ appearance: { maxMessages: Number(event.target.value) } })
                }
              />
            </label>

            <label className="field">
              <span>Скрывать через</span>
              <select
                value={config.appearance.hideAfterMs}
                onChange={(event) =>
                  patch({ appearance: { hideAfterMs: Number(event.target.value) } })
                }
              >
                <option value={0}>никогда</option>
                <option value={15000}>15 сек</option>
                <option value={30000}>30 сек</option>
                <option value={60000}>1 мин</option>
                <option value={120000}>2 мин</option>
              </select>
            </label>

            <div className="field toggles">
              <label className="check">
                <input
                  type="checkbox"
                  checked={config.appearance.showBadges}
                  onChange={(event) => patch({ appearance: { showBadges: event.target.checked } })}
                />
                Бейджи
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={config.appearance.showTimestamps}
                  onChange={(event) => patch({ appearance: { showTimestamps: event.target.checked } })}
                />
                Время
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={config.appearance.showSourceColor}
                  onChange={(event) => patch({ appearance: { showSourceColor: event.target.checked } })}
                />
                Цвет источника
              </label>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Оверлей и горячие клавиши</h2>
          </div>
          <div className="field toggles">
            <label className="check">
              <input
                type="checkbox"
                checked={config.overlay.clickThrough}
                onChange={(event) => patch({ overlay: { clickThrough: event.target.checked } })}
              />
              Сквозной режим (клики проходят в игру)
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={config.overlay.visible}
                onChange={(event) =>
                  void api.overlayAction(event.target.checked ? 'show' : 'hide')
                }
              />
              Показывать оверлей
            </label>
          </div>
          <ul className="keys">
            <li>
              <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>O</kbd> — переключить сквозной режим
            </li>
            <li>
              <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>H</kbd> — скрыть / показать оверлей
            </li>
            <li>
              <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>S</kbd> — настройки
            </li>
          </ul>
          <p className="muted small">
            В интерактивном режиме оверлей можно перетаскивать за шапку. Поверх эксклюзивного
            fullscreen оверлей не отображается — используйте borderless/windowed режим игры.
          </p>
        </section>
      </main>
    </div>
  )
}
