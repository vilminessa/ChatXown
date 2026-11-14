import { useEffect, useRef, useState } from 'react'
import type {
  AppConfig,
  AuthStatus,
  DeviceFlowStart,
  Platform,
  SourceConfig,
  SourceStatus
} from '../../../shared/types'

const api = window.chatxown

const STATE_LABELS: Record<SourceStatus['state'], string> = {
  idle: 'выключен',
  connecting: 'подключается',
  connected: 'в чате',
  offline: 'не в эфире',
  error: 'ошибка'
}

const SCOPE_LABELS: Record<string, string> = {
  'moderator:manage:banned_users': 'баны и таймауты',
  'moderator:manage:chat_messages': 'удаление сообщений'
}

export function App(): React.JSX.Element {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [statuses, setStatuses] = useState<SourceStatus[]>([])
  const [auth, setAuth] = useState<AuthStatus | null>(null)
  const [input, setInput] = useState('')
  const [platform, setPlatform] = useState<'auto' | Platform>('auto')
  const [addError, setAddError] = useState('')

  const [clientId, setClientId] = useState('')
  const [device, setDevice] = useState<DeviceFlowStart | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState('')
  const pollTimer = useRef<number | null>(null)

  useEffect(() => {
    void api.getState().then((state) => {
      setConfig(state.config)
      setStatuses(state.statuses)
      setAuth(state.auth)
      setClientId(state.config.twitch.clientId)
    })
    const offConfig = api.onConfig((next) => setConfig(next))
    const offStatus = api.onStatus((next) => setStatuses(next))
    const offAuth = api.onAuthChanged((next) => setAuth(next))
    return () => {
      offConfig()
      offStatus()
      offAuth()
    }
  }, [])

  useEffect(
    () => () => {
      if (pollTimer.current !== null) window.clearTimeout(pollTimer.current)
    },
    []
  )

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

  const stopPolling = (): void => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current)
      pollTimer.current = null
    }
  }

  const poll = (id: string, interval: number): void => {
    stopPolling()
    pollTimer.current = window.setTimeout(async () => {
      const result = await api.authDevicePoll(id).catch(
        (error: Error) => ({ state: 'error' as const, auth, error: error.message })
      )
      if (result.state === 'pending') {
        poll(id, interval)
        return
      }
      stopPolling()
      setDevice(null)
      setAuth(result.auth)
      if (result.state !== 'ok') setAuthError(result.error ?? 'Не удалось войти')
    }, Math.max(2, interval) * 1000)
  }

  const startLogin = async (): Promise<void> => {
    const id = clientId.trim()
    setAuthError('')
    if (!id) {
      setAuthError('Сначала вставьте Client ID приложения Twitch')
      return
    }
    setAuthBusy(true)
    if (id !== config.twitch.clientId) {
      patch({ twitch: { clientId: id } })
    }
    const result = await api.authDeviceStart(id)
    setAuthBusy(false)
    if (!result.ok || !result.device) {
      setAuthError(result.error ?? 'Twitch не выдал код')
      return
    }
    setDevice(result.device)
    void api.openExternal(result.device.verificationUri)
    poll(id, result.device.interval)
  }

  const cancelLogin = (): void => {
    stopPolling()
    setDevice(null)
    setAuthError('')
  }

  const logout = async (): Promise<void> => {
    cancelLogin()
    setAuth(await api.authLogout())
  }

  const scopeChips = (auth?.scopes ?? []).map((scope) => SCOPE_LABELS[scope] ?? scope)

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>ChatXown</h1>
          <p className="sub">Оверлей чата Twitch и YouTube · модерация Twitch</p>
        </div>
        <button className="ghost" onClick={() => void api.overlayAction('show')}>
          Показать оверлей
        </button>
      </header>

      <main>
        <section className="card">
          <div className="card-head">
            <h2>Аккаунт Twitch</h2>
            {auth?.loggedIn && <span className="pill pill-ok">@ {auth.login}</span>}
          </div>

          {auth?.loggedIn ? (
            <>
              <p className="muted small">
                Вход выполнен. В интерактивном режиме оверлея (Ctrl+Alt+O) при наведении на сообщение
                появляются кнопки удаления, таймаута и бана.
              </p>
              <div className="chips">
                {scopeChips.length > 0 ? (
                  scopeChips.map((label) => (
                    <span className="chip chip-scope" key={label}>
                      {label}
                    </span>
                  ))
                ) : (
                  <span className="muted small">Разрешения не указаны</span>
                )}
              </div>
              <div className="row">
                <button className="ghost danger" onClick={() => void logout()}>
                  Выйти из Twitch
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted small">
                Для модерации нужен OAuth-вход. Создайте приложение в{' '}
                <a
                  className="link"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault()
                    void api.openExternal('https://dev.twitch.tv/console/apps')
                  }}
                >
                  Twitch Developer Console
                </a>{' '}
                (OAuth redirect URL — <code>http://localhost</code>), скопируйте <b>Client ID</b> и вставьте
                сюда. Client Secret не нужен.
              </p>

              <div className="auth-row">
                <input
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder="Client ID приложения Twitch"
                  spellCheck={false}
                />
                <button className="primary" disabled={authBusy || Boolean(device)} onClick={() => void startLogin()}>
                  {authBusy ? 'Запрашиваем…' : 'Войти через Twitch'}
                </button>
              </div>

              {clientId.trim() !== config.twitch.clientId && clientId.trim() !== '' && (
                <p className="muted small">Client ID сохранится при входе.</p>
              )}

              {device && (
                <div className="device">
                  <div className="device-code">{device.userCode}</div>
                  <div className="device-side">
                    <p className="small">
                      Введите этот код на{' '}
                      <a
                        className="link"
                        href="#"
                        onClick={(event) => {
                          event.preventDefault()
                          void api.openExternal(device.verificationUri)
                        }}
                      >
                        {device.verificationUri.replace(/^https?:\/\//, '')}
                      </a>{' '}
                      и подтвердите доступ.
                    </p>
                    <p className="muted small">
                      <span className="spinner" /> Ждём подтверждения… Код действует{' '}
                      {Math.round(device.expiresIn / 60)} мин.
                    </p>
                    <button className="ghost" onClick={cancelLogin}>
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              {authError && <p className="error">{authError}</p>}
            </>
          )}
        </section>

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
              placeholder="twitch.tv/канал, youtube.com/@канал или ссылка на видео"
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
          <p className="muted small">
            YouTube: @handle, ID канала <code>UC…</code>, ссылка на канал или на конкретный эфир. Если
            канал не в эфире, ChatXown ждёт и подключится автоматически.
          </p>

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
                    {source.platform === 'twitch' ? (
                      <>
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
                      </>
                    ) : (
                      <span className="muted small">
                        YouTube: нативные эмоуты канала (7TV/BTTV/FFZ не поддерживают YouTube)
                      </span>
                    )}

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
              <kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>O</kbd> — переключить сквозной режим (кнопки
              модерации работают только в интерактивном режиме)
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
