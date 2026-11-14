import { appendFileSync, writeFileSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import type { InteractiveState, OverlayAction, OverlayConfig, ScreenRect, SourceStatus } from '../shared/types'

export interface ProbeDeps {
  win: BrowserWindow
  /** Where the screenshots are written. */
  file: string
  overlay: () => OverlayConfig
  /** Config schema version: 2 means click-through migration has been applied. */
  configVersion: () => number
  sources: () => string[]
  statuses: () => SourceStatus[]
  /** Drive hide / show / click-through exactly like the tray and hotkeys do. */
  action: (action: OverlayAction) => void
  /** Put the chat area somewhere with real space around it, so zone tests mean something. */
  setChat: (rect: ScreenRect | null) => void
  /** What main actually applied to the window. */
  interaction: () => { target: InteractiveState; ignoreMouse: boolean; focusable: boolean; visible: boolean; polling: boolean }
  /** Turn the main-side cursor watcher on/off so assertions stay deterministic. */
  setPoll: (enabled: boolean) => void
}

interface UiState {
  rect: { x: number; y: number; width: number; height: number }
  head: { x: number; y: number; width: number; height: number }
  toolbar: { x: number; y: number; width: number; height: number } | null
  cls: string
  /** Renderer's own reasons for holding the capture, set by App for the probe. */
  ui: string
  toolbarShown: boolean
  modal: boolean
  vw: number
  vh: number
}

/**
 * Drives the overlay UI from the main process: hover capture, drag, settings modal,
 * the hide -> show cycle and the layout toolbar inside the chat area.
 * CHATXOWN_PROBE=path.png npm run dev — writes screenshots and logs each step.
 */
export function runUiProbe(deps: ProbeDeps): void {
  /** Packaged builds discard GUI stdout, so mirror every step into a file next to the screenshots. */
  const logFile = deps.file.replace(/\.png$/, '-run.log')
  const log = (line: string): void => {
    console.log(line)
    try {
      appendFileSync(logFile, `${line}\n`)
    } catch {
      /* best effort */
    }
  }
  /** The probe rewrites the layout while running; put the user's config back afterwards. */
  const initial = deps.overlay()
  const initialChat = initial.chat
  const initialPoll = initial.pollCursor

  const restore = (): void => {
    deps.setChat(initialChat)
    deps.setPoll(initialPoll)
  }

  void (async () => {
    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

    /** The cursor watcher would read the real OS cursor; keep it off while asserting. */
    deps.setPoll(false)

    const js = async (code: string): Promise<unknown> => {
      try {
        return await deps.win.webContents.executeJavaScript(code)
      } catch (error) {
        console.error('[probe] script failed:', code.slice(0, 70), error)
        return null
      }
    }

    /** Geometry and UI state as the renderer sees it (CSS px == DIP). */
    const uiState = async (): Promise<UiState> => {
      const raw = await js(
        `(() => {
          const chat = document.querySelector('.chat')
          const head = document.querySelector('.chat-head')
          const toolbar = document.querySelector('.chat-toolbar')
          const box = (el) => {
            if (!el) return null
            const b = el.getBoundingClientRect()
            return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
          }
          return JSON.stringify({
            rect: box(chat),
            head: box(head),
            toolbar: box(toolbar),
            cls: chat.className,
            ui: document.body.dataset.ui ?? '',
            toolbarShown: Boolean(toolbar),
            modal: Boolean(document.querySelector('.modal')),
            vw: window.innerWidth,
            vh: window.innerHeight
          })
        })()`
      )
      return JSON.parse(String(raw ?? '{}')) as UiState
    }

    const hoverAt = async (x: number, y: number, settle = 300): Promise<void> => {
      const failure = await js(
        `(() => {
          try {
            const el = document.elementFromPoint(${x}, ${y})
            if (el) el.dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true }))
            return null
          } catch (error) {
            return String(error && error.message)
          }
        })()`
      )
      if (failure) log(`[probe] hover ${x},${y} threw: ${failure}`)
      await wait(settle)
    }

    /** Synthetic mousemove cannot prove the OS hit-tests the toolbar, so ask the DOM. */
    const hitsToolbar = async (box: UiState['toolbar']): Promise<boolean> => {
      if (!box) return false
      const cx = Math.round(box.x + box.width / 2)
      const cy = Math.round(box.y + box.height / 2)
      return Boolean(
        await js(
          `(() => {
            const el = document.elementFromPoint(${cx}, ${cy})
            return el ? el.closest('.chat-toolbar') !== null : false
          })()`
        )
      )
    }

    const shoot = async (file: string): Promise<void> => {
      const image = await deps.win.webContents.capturePage()
      writeFileSync(file, image.toPNG())
      log(`[probe] captured ${file}`)
    }

    const logInteraction = (label: string): void => {
      const snap = deps.interaction()
      log(
        `[probe] ${label}: ignoreMouse=${snap.ignoreMouse} focusable=${snap.focusable} ` +
          `visible=${snap.visible} target=${JSON.stringify(snap.target)} polling=${snap.polling}`
      )
    }

    const centre = (box: { x: number; y: number; width: number; height: number }): [number, number] => [
      Math.round(box.x + box.width / 2),
      Math.round(box.y + box.height / 2)
    ]

    /** The renderer may still be booting (dev server compiles on demand), so wait for the UI. */
    const ready = async (): Promise<UiState> => {
      for (let i = 0; i < 40; i += 1) {
        const mounted = await js(
          `Boolean(document.querySelector(".chat") && document.querySelector(".chat-head"))`
        )
        if (mounted) return await uiState()
        await wait(500)
      }
      throw new Error('renderer never mounted .chat')
    }

    /** First point outside the chat area (including the hover padding). */
    const outsidePoint = (state: UiState): [number, number] => {
      const pad = 12
      const candidates: Array<[number, number]> = [
        [state.vw - 1, state.vh - 1],
        [state.vw - 1, Math.round(state.vh / 2)],
        [Math.round(state.vw / 2), state.vh - 1],
        [Math.max(0, state.rect.x - 60), state.rect.y + 6]
      ]
      return (
        candidates.find(
          ([x, y]) =>
            x < state.rect.x - pad || x > state.rect.x + state.rect.width + pad || y < state.rect.y - pad || y > state.rect.y + state.rect.height + pad
        ) ?? [state.vw - 1, state.vh - 1]
      )
    }

    await wait(2500)
    let state = await ready()
    log(
      `[probe] config v${deps.configVersion()} overlay=${JSON.stringify(deps.overlay())} ` +
        `polling=${deps.interaction().polling}`
    )
    // Deterministic starting layout: a chat area with real space around it.
    deps.setChat({ x: 640, y: 280, width: 720, height: 620 })
    await wait(500)
    state = await uiState()
    await hoverAt(...centre(state.rect), 500)
    state = await uiState()
    log(
      `[probe] over chat -> cls=${state.cls} toolbar=${state.toolbarShown} rect=${JSON.stringify(state.rect)}`
    )
    logInteraction('over chat')
    await shoot(deps.file)

    // Leave the zone: capture must be released after the grace period.
    const [ox, oy] = outsidePoint(state)
    await hoverAt(ox, oy, 900)
    state = await uiState()
    log(`[probe] outside chat (${ox},${oy}) -> cls=${state.cls} toolbar=${state.toolbarShown}`)
    logInteraction('outside chat')

    // Capture-all mode: the overlay holds the whole screen, and says so in the head + a toast.
    deps.action('toggle-click-through')
    await wait(700)
    logInteraction('click-through off')
    log(
      `[probe] click-through off -> config=${JSON.stringify(deps.overlay())} ` +
        `chip=${Boolean(await js('Boolean(document.querySelector(".capture-chip"))'))} ` +
        `toast=${Boolean(await js('Boolean(document.querySelector(".toast"))'))}`
    )
    await shoot(deps.file.replace(/\.png$/, '-capture.png'))
    deps.action('toggle-click-through')
    await wait(700)
    logInteraction('click-through on')
    log(
      `[probe] click-through on -> config=${JSON.stringify(deps.overlay())} ` +
        `chip=${Boolean(await js('Boolean(document.querySelector(".capture-chip"))'))}`
    )

    // drag the chat area by its head, then release
    const gx = state.head.x + state.head.width / 2
    const gy = state.head.y + 10
    await js(
      `document.querySelector('.chat-head').dispatchEvent(new PointerEvent('pointerdown', { clientX: ${gx}, clientY: ${gy}, button: 0, bubbles: true }))`
    )
    await js(
      `window.dispatchEvent(new PointerEvent('pointermove', { clientX: ${gx - 260}, clientY: ${gy + 140}, bubbles: true }))`
    )
    await wait(200)
    state = await uiState()
    log(`[probe] dragging -> rect=${JSON.stringify(state.rect)} cls=${state.cls}`)
    await js(
      `window.dispatchEvent(new PointerEvent('pointerup', { clientX: ${gx - 260}, clientY: ${gy + 140}, bubbles: true }))`
    )
    await wait(900)
    log(`[probe] config after drag -> ${JSON.stringify(deps.overlay())}`)

    // settings modal: open it, type into the add-source field, add a channel
    await js(`document.querySelector('.chat-actions button').click()`)
    await wait(500)
    state = await uiState()
    log(`[probe] modal=${state.modal}`)
    logInteraction('modal open')
    await shoot(deps.file.replace(/\.png$/, '-panel.png'))

    await js(
      `const input = document.querySelector('.add-row input')
       const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
       setter.call(input, '@MrBeast')
       input.dispatchEvent(new Event('input', { bubbles: true }))
       const add = [...document.querySelectorAll('.add-row button')].find((b) => b.textContent.includes('Добавить'))
       add.click()`
    )
    await wait(2500)
    log(`[probe] statuses -> ${deps.statuses().map((s) => `${s.channel}:${s.state}`).join(', ')}`)
    log(`[probe] sources -> ${deps.sources().join(', ')}`)
    await shoot(deps.file.replace(/\.png$/, '-panel2.png'))

    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await wait(400)
    log(`[probe] modal after Esc -> ${String(await js('Boolean(document.querySelector(".modal"))'))}`)

    // hide -> show: the window must become clickable again, not merely visible
    deps.action('hide')
    await wait(600)
    logInteraction('after hide')
    log(
      `[probe] renderer cls while hidden -> ${String(await js(`document.querySelector('.chat')?.className ?? 'none'`))}`
    )
    deps.action('show')
    await wait(900)
    logInteraction('after show (no pointer yet)')
    const shown = await uiState()
    log(`[probe] cls right after show -> ${shown.cls} ui=${shown.ui}`)
    state = await uiState()
    await hoverAt(...centre(state.rect), 500)
    state = await uiState()
    log(`[probe] after show, over chat -> cls=${state.cls} toolbar=${state.toolbarShown}`)
    logInteraction('after show, over chat')
    await shoot(deps.file.replace(/\.png$/, '-reshow.png'))

    // the toolbar sits inside the chat area, so the pointer over it keeps the capture
    state = await uiState()
    if (state.toolbar) {
      await hoverAt(...centre(state.toolbar), 500)
      state = await uiState()
      log(
        `[probe] over toolbar ${JSON.stringify(state.toolbar)} -> toolbar=${state.toolbarShown} hit=${await hitsToolbar(state.toolbar)}`
      )
      logInteraction('over toolbar')
      await js(`[...document.querySelectorAll('.chat-toolbar button')][1].click()`)
      await wait(900)
      log(`[probe] anchor ⌜ click -> ${JSON.stringify(deps.overlay().chat)}`)
    } else {
      log('[probe] toolbar missing after hide/show')
    }

    // release again, then re-show: chat hover must bring the toolbar back, toolbar hover must keep it
    const [rx, ry] = outsidePoint(await uiState())
    await hoverAt(rx, ry, 900)
    deps.action('hide')
    await wait(600)
    deps.action('show')
    await wait(900)
    logInteraction('after re-show (no pointer yet)')
    const reshown = await uiState()
    log(`[probe] cls right after re-show -> ${reshown.cls} ui=${reshown.ui}`)
    state = reshown
    await hoverAt(...centre(state.rect), 500)
    state = await uiState()
    log(`[probe] re-show + chat hover -> cls=${state.cls} toolbar=${state.toolbarShown}`)
    if (state.toolbar) {
      await hoverAt(...centre(state.toolbar), 500)
      const again = await uiState()
      log(
        `[probe] re-show + toolbar hover -> cls=${again.cls} toolbar=${again.toolbarShown} hit=${await hitsToolbar(state.toolbar)}`
      )
      logInteraction('re-show + toolbar hover')
    } else {
      log('[probe] toolbar missing after re-show')
    }

    // stretch the chat over the whole overlay
    state = await uiState()
    await hoverAt(...centre(state.rect), 500)
    state = await uiState()
    log(`[probe] toolbar before fullscreen -> ${state.toolbarShown}`)
    if (state.toolbarShown) await js(`document.querySelector('.chat-toolbar button').click()`)
    await wait(900)
    log(`[probe] config after fullscreen -> ${JSON.stringify(deps.overlay())}`)
    state = await uiState()
    log(`[probe] viewport ${state.vw}x${state.vh}, rect=${JSON.stringify(state.rect)}`)
    await shoot(deps.file.replace(/\.png$/, '-full.png'))

    // cursor watcher: main decides the capture from the real cursor position
    deps.setPoll(true)
    await wait(700)
    logInteraction('cursor watcher on')

    // the watcher follows the real cursor; leave it running for the human-readable log
    for (let i = 0; i < 4; i += 1) {
      await wait(400)
      logInteraction(`watcher tick ${i + 1}`)
    }

    restore()
    await wait(400)
    log(`[probe] config restored -> ${JSON.stringify(deps.overlay())}`)
  })().catch((error) => {
    restore()
    log(`[probe] failed ${String(error)}`)
    console.error('[probe] failed', error)
  })
}
