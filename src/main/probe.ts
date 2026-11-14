import type { BrowserWindow } from 'electron'
import type { OverlayConfig, SourceStatus } from '../shared/types'

export interface ProbeDeps {
  win: BrowserWindow
  /** Where the screenshots are written. */
  file: string
  overlay: () => OverlayConfig
  sources: () => string[]
  statuses: () => SourceStatus[]
}

interface UiState {
  rect: { x: number; y: number; width: number; height: number }
  head: { x: number; y: number; width: number; height: number }
  cls: string
  toolbar: boolean
  modal: boolean
  vw: number
  vh: number
}

/**
 * Drives the overlay UI from the main process: hover capture, drag, settings modal.
 * CHATXOWN_PROBE=path.png npm run dev — writes screenshots and logs each step.
 */
export function runUiProbe(deps: ProbeDeps): void {
  void (async () => {
    const { writeFileSync } = await import('node:fs')
    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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
          const box = (el) => {
            const b = el.getBoundingClientRect()
            return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
          }
          return JSON.stringify({
            rect: box(chat),
            head: box(head),
            cls: chat.className,
            toolbar: Boolean(document.querySelector('.chat-toolbar')),
            modal: Boolean(document.querySelector('.modal')),
            vw: window.innerWidth,
            vh: window.innerHeight
          })
        })()`
      )
      return JSON.parse(String(raw ?? '{}')) as UiState
    }

    const hoverAt = async (x: number, y: number): Promise<void> => {
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
      if (failure) console.log(`[probe] hover ${x},${y} threw: ${failure}`)
      await wait(300)
    }

    const shoot = async (file: string): Promise<void> => {
      const image = await deps.win.webContents.capturePage()
      writeFileSync(file, image.toPNG())
      console.log(`[probe] captured ${file}`)
    }

    await wait(5000)
    let state = await uiState()
    await hoverAt(state.rect.x + state.rect.width / 2, state.rect.y + state.rect.height / 2)
    state = await uiState()
    console.log(`[probe] over chat -> cls=${state.cls} toolbar=${state.toolbar} rect=${JSON.stringify(state.rect)}`)
    await shoot(deps.file)

    const outsideX =
      state.rect.x > 80 ? state.rect.x - 60 : Math.min(state.rect.x + state.rect.width + 60, state.vw - 1)
    await hoverAt(outsideX, state.rect.y + 6)
    state = await uiState()
    console.log(`[probe] outside chat -> cls=${state.cls} toolbar=${state.toolbar}`)

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
    console.log(`[probe] dragging -> rect=${JSON.stringify(state.rect)} cls=${state.cls}`)
    await js(
      `window.dispatchEvent(new PointerEvent('pointerup', { clientX: ${gx - 260}, clientY: ${gy + 140}, bubbles: true }))`
    )
    await wait(900)
    console.log(`[probe] config after drag -> ${JSON.stringify(deps.overlay())}`)

    // settings modal: open it, type into the add-source field, add a channel
    await js(`document.querySelector('.chat-actions button').click()`)
    await wait(500)
    state = await uiState()
    console.log(`[probe] modal=${state.modal}`)
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
    console.log(`[probe] statuses -> ${deps.statuses().map((s) => `${s.channel}:${s.state}`).join(', ')}`)
    console.log(`[probe] sources -> ${deps.sources().join(', ')}`)
    await shoot(deps.file.replace(/\.png$/, '-panel2.png'))

    await js(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await wait(400)
    console.log(`[probe] modal after Esc -> ${String(await js('Boolean(document.querySelector(".modal"))'))}`)

    // stretch the chat over the whole overlay
    state = await uiState()
    await hoverAt(state.rect.x + state.rect.width / 2, state.rect.y + state.rect.height / 2)
    state = await uiState()
    console.log(`[probe] toolbar before fullscreen -> ${state.toolbar}`)
    if (state.toolbar) await js(`document.querySelector('.chat-toolbar button').click()`)
    await wait(900)
    console.log(`[probe] config after fullscreen -> ${JSON.stringify(deps.overlay())}`)
    state = await uiState()
    console.log(`[probe] viewport ${state.vw}x${state.vh}, rect=${JSON.stringify(state.rect)}`)
    await shoot(deps.file.replace(/\.png$/, '-full.png'))
  })().catch((error) => console.error('[probe] failed', error))
}
