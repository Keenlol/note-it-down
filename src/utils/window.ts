// Shared 21-week window (matches the heatmap) used by the bodyweight and preset
// graphs so plotted points line up with the heatmap cells above them.
export const WEEKS = 21

/** First day of the visible window (Sunday-aligned), at local midnight. */
export function windowStart(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(today.getDate() - (WEEKS - 1) * 7 - today.getDay())
  return start
}

/** Whole-day offset of a YYYY-MM-DD date from the window start. */
export function dayIndex(dateStr: string, start: Date): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return Math.round((date.getTime() - start.getTime()) / 86_400_000)
}
