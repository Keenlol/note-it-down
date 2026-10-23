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

/**
 * Press-and-pop, for controls whose bounce has to be seen. A finger covers a
 * button while it's down, so a bounce played on press is already over by the
 * time the finger lifts. Instead `press` squashes the button and holds it
 * there (`.pressing`), and `release` plays the pop (`.tapping`) as the finger
 * comes away. `cancelPress` drops the squash without a pop — for a press that
 * slid off or was taken over by a scroll.
 */
export function press(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  el.classList.remove('tapping')
  el.classList.add('pressing')
}

export function release(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget
  if (!el.classList.contains('pressing')) return
  el.classList.remove('pressing')
  void el.offsetWidth          // force reflow so animation restarts
  el.classList.add('tapping')
}

export function cancelPress(e: PointerEvent<HTMLElement>) {
  e.currentTarget.classList.remove('pressing')
}
