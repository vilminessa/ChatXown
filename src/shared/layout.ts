import type { ScreenRect } from './types'

/** Smallest chat area the user can drag down to. */
export const MIN_CHAT = { width: 200, height: 120 }
/** Snap distance (px) to the overlay edges while dragging. */
export const SNAP = 12

export interface Viewport {
  width: number
  height: number
}

export type Anchor = 'tl' | 'tr' | 'bl' | 'br'

export function fullRect(view: Viewport): ScreenRect {
  return { x: 0, y: 0, width: view.width, height: view.height }
}

/** Keep the chat area inside the overlay window and above the minimum size. */
export function clampRect(rect: ScreenRect, view: Viewport): ScreenRect {
  const width = Math.round(Math.max(MIN_CHAT.width, Math.min(rect.width, view.width)))
  const height = Math.round(Math.max(MIN_CHAT.height, Math.min(rect.height, view.height)))
  const x = Math.round(Math.min(Math.max(rect.x, 0), Math.max(0, view.width - width)))
  const y = Math.round(Math.min(Math.max(rect.y, 0), Math.max(0, view.height - height)))
  return { x, y, width, height }
}

/** Pull the rect towards the nearest screen corner, keeping its size. */
export function anchorRect(rect: ScreenRect, anchor: Anchor, view: Viewport): ScreenRect {
  const size = clampRect(rect, view)
  const x = anchor === 'tl' || anchor === 'bl' ? 0 : view.width - size.width
  const y = anchor === 'tl' || anchor === 'tr' ? 0 : view.height - size.height
  return { ...size, x, y }
}

/** Snap a coordinate to 0 or to its maximum when within SNAP px of it. */
export function snap(value: number, max: number): number {
  if (value <= SNAP) return 0
  if (value >= max - SNAP) return max
  return value
}

export function sameRect(a: ScreenRect | null, b: ScreenRect): boolean {
  if (!a) return false
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
