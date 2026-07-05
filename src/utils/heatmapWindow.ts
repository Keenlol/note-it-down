// Geometry of the heatmap's paged 21-week windows ("sets"). Set 0 is the
// today-anchored window; set n is the 21 weeks before set n-1. Shared by the
// inline heatmap (which pages back as you browse older days) and the stacked
// history overlay (which renders one set per window).

export const WEEKS = 21
const DAY_MS = 86_400_000

// First (Sunday) column of the today-anchored window (weekOffset 0), at local midnight.
function set0Start(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(today.getDate() - (WEEKS - 1) * 7 - today.getDay())
  return start
}

// Which paged window (as a weekOffset, a multiple of WEEKS) contains `dateStr`.
// Returns 0 for today / recent dates and for null.
export function weekOffsetForDate(dateStr: string | null): number {
  if (!dateStr) return 0
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setHours(0, 0, 0, 0)
  const dateWeekStart = new Date(date)
  dateWeekStart.setDate(date.getDate() - date.getDay())

  const weeksBefore = Math.round((set0Start().getTime() - dateWeekStart.getTime()) / (7 * DAY_MS))
  if (weeksBefore <= 0) return 0
  const setIndex = Math.floor((weeksBefore - 1) / WEEKS) + 1
  return setIndex * WEEKS
}

// How many stacked 21-week sets are needed to cover history back to `oldestKey`.
export function historySetCount(oldestKey: string | null): number {
  return weekOffsetForDate(oldestKey) / WEEKS + 1
}
