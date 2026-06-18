import { BEFORE, AFTER, type Phrase } from './encouragement-data'

export type { Phrase } from './encouragement-data'
export type Phase = 'before' | 'after'

// Per-pool progress, persisted so phrases advance only on days one is actually
// shown — never skipped on days the app isn't opened.
//   idx     — index of the phrase currently/last shown
//   date    — the day (YYYY-MM-DD) idx was shown for
//   started — false until the very first phrase has been served
interface Cursor {
  idx: number
  date: string
  started: boolean
}

const storageKey = (phase: Phase) => `encouragement_${phase}`

function readCursor(phase: Phase): Cursor {
  try {
    const raw = localStorage.getItem(storageKey(phase))
    if (raw) {
      const c = JSON.parse(raw)
      if (typeof c?.idx === 'number' && typeof c?.date === 'string') {
        return { idx: c.idx, date: c.date, started: c.started !== false }
      }
    }
  } catch {
    /* fall through to default */
  }
  return { idx: 0, date: '', started: false }
}

function writeCursor(phase: Phase, c: Cursor) {
  try {
    localStorage.setItem(storageKey(phase), JSON.stringify(c))
  } catch {
    /* ignore quota / disabled storage */
  }
}

// Resolve the phrase for `today`, walking the pool sequentially.
// - First time ever for a phase → serve phrase #0.
// - Already served today → return the same phrase (stable all day, idempotent).
// - A new day → advance exactly one step (wrapping), so unseen phrases are
//   never skipped just because some days went by without opening the app.
export function getEncouragement(today: string, phase: Phase): Phrase | null {
  const pool = phase === 'before' ? BEFORE : AFTER
  if (pool.length === 0) return null

  const cur = readCursor(phase)

  if (!cur.started) {
    writeCursor(phase, { idx: 0, date: today, started: true })
    return pool[0]
  }

  if (cur.date === today) {
    return pool[cur.idx % pool.length]
  }

  const idx = (cur.idx + 1) % pool.length
  writeCursor(phase, { idx, date: today, started: true })
  return pool[idx]
}
