import type { PointerEvent } from 'react'

/**
 * Tap animation helper. Add `onPointerDown={tap}` to any element you want
 * to bounce on tap. Edit @keyframes tap-scale in index.css to change the feel.
 *
 * Uses classList directly (no React state) for efficiency. The remove+reflow+add
 * pattern restarts the animation if the element is tapped again rapidly.
 * `animation-fill-mode: both` in CSS holds at scale(1) after completion, so the
 * class never needs removal — the next tap just restarts it.
 */
export function tap(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  el.classList.remove('tapping')
  void el.offsetWidth          // force reflow so animation restarts
  el.classList.add('tapping')
}
