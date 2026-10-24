// Undo and redo, one history per day, kept for as long as the app is open.
//
// A step is a snapshot of the day's whole note. Every edit, from either mode,
// goes through `remember`, so the note and the eye's view share one history.
// Typing runs together into one step until it pauses or starts a new line;
// anything else — a grip move, a swap, a filled suggestion, a trash, one whole
// value drag — is tagged with a group of its own and makes exactly one step.

interface DayHistory {
  past: string[]          // older snapshots, newest last
  future: string[]        // undone snapshots, the next redo last
  group: string | null    // what the last remembered edit belonged to
  at: number              // when it was remembered
}

/** Typing that pauses this long starts a new step. */
const TYPING_GAP_MS = 1000
/** Steps kept per day. */
const LIMIT = 200

const days = new Map<string, DayHistory>()
let seq = 0

/** A fresh group: every change passed with it lands in one step. */
export const newEditGroup = () => `edit${++seq}`

function historyOf(day: string): DayHistory {
  let h = days.get(day)
  if (!h) { h = { past: [], future: [], group: null, at: 0 }; days.set(day, h) }
  return h
}

/** Note that `day` changed from `prev` to `next`; no group means typing. */
export function remember(day: string, prev: string, next: string, group?: string): void {
  if (prev === next) return
  const h = historyOf(day)
  const now = Date.now()
  const typing = group === undefined
  const newLine = next.split('\n').length !== prev.split('\n').length
  const joins = typing
    ? h.group === 'typing' && now - h.at < TYPING_GAP_MS && !newLine
    : h.group === group
  if (!joins) {
    h.past.push(prev)
    if (h.past.length > LIMIT) h.past.shift()
  }
  h.future = []
  h.group = typing ? 'typing' : group
  h.at = now
}

/** The text to go back to, or null with nothing to undo. */
export function undo(day: string, current: string): string | null {
  const h = days.get(day)
  if (!h || h.past.length === 0) return null
  h.future.push(current)
  h.group = null
  return h.past.pop()!
}

/** The text to go forward to, or null with nothing to redo. */
export function redo(day: string, current: string): string | null {
  const h = days.get(day)
  if (!h || h.future.length === 0) return null
  h.past.push(current)
  h.group = null
  return h.future.pop()!
}

export const canUndo = (day: string) => (days.get(day)?.past.length ?? 0) > 0
export const canRedo = (day: string) => (days.get(day)?.future.length ?? 0) > 0
