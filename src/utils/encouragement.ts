import { BEFORE, AFTER, type Phrase } from './encouragement-data'

export type { Phrase } from './encouragement-data'
export type Phase = 'before' | 'after'

// Whole-day number for a YYYY-MM-DD date, used to rotate phrases once per day.
function dayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

// Deterministic phrase for a given day + phase: stable all day, rotates daily.
// The +13 offset on `after` keeps the same day's before/after lines from
// landing on the same index pattern, so they feel distinct.
export function getEncouragement(dateStr: string, phase: Phase): Phrase | null {
  const pool = phase === 'before' ? BEFORE : AFTER
  if (pool.length === 0) return null
  const idx = dayIndex(dateStr) + (phase === 'after' ? 13 : 0)
  return pool[((idx % pool.length) + pool.length) % pool.length]
}
