const BW_KEY = 'nid-bodyweight'

export interface BwEntry {
  date: string   // YYYY-MM-DD
  weight: number // kg
}

export function loadBwHistory(): BwEntry[] {
  try {
    const raw = localStorage.getItem(BW_KEY)
    if (!raw) return []
    return (JSON.parse(raw) as BwEntry[]).sort((a, b) => a.date.localeCompare(b.date))
  } catch {
    return []
  }
}

function saveBwHistoryRaw(entries: BwEntry[]): void {
  localStorage.setItem(BW_KEY, JSON.stringify(entries))
}

export function setBwEntry(date: string, weight: number): void {
  const history = loadBwHistory()
  const idx = history.findIndex(e => e.date === date)
  if (idx >= 0) {
    history[idx].weight = weight
  } else {
    history.push({ date, weight })
    history.sort((a, b) => a.date.localeCompare(b.date))
  }
  saveBwHistoryRaw(history)
}

/**
 * Bodyweight in kg applicable on a given date.
 * - Uses the most recent entry at or before `date`.
 * - If no entry exists before `date`, falls back to the oldest entry
 *   (first-ever entry acts as a global baseline covering all past dates).
 * - Returns 60 if nothing has been set yet.
 */
export function getBwOn(date: string): number {
  const history = loadBwHistory()
  if (history.length === 0) return 60
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].date <= date) return history[i].weight
  }
  // Before first entry → use first entry as global baseline
  return history[0].weight
}

export function isBwSet(): boolean {
  return loadBwHistory().length > 0
}
