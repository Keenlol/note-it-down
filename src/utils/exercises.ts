import { getAllDayKeys, loadDay, saveDay } from './storage'
import { parseLine, normalizeName, totalVolume } from './parser'
import { getBwOn } from './bodyweight'

const ALIASES_KEY = 'nid-aliases'

export interface ExerciseEntry {
  norm: string         // normalized canonical key
  displayName: string  // best human-readable name
  count: number        // total occurrences across all days
  lastSeen: string     // YYYY-MM-DD
  nicknames: string[]  // other norms that alias to this canonical
}

export type SortMode = 'az' | 'za' | 'count' | 'recent'

export function relativeTime(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const then = new Date(y, m - 1, d)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const days = Math.round((now.getTime() - then.getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return '1 week ago'
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`
  if (days < 60) return '1 month ago'
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  if (days < 730) return '1 year ago'
  return `${Math.floor(days / 365)} years ago`
}

export function buildCatalog(
  aliases: Record<string, string>,
  sort: SortMode = 'count',
): ExerciseEntry[] {
  const map = new Map<string, { count: number; lastSeen: string; rawNames: Map<string, number> }>()

  const resolve = (norm: string) => aliases[norm] ?? norm

  for (const date of getAllDayKeys()) {
    const day = loadDay(date)
    if (!day) continue
    for (const line of day.rawText.split('\n')) {
      const p = parseLine(line)
      if (!p.exercise?.name) continue
      const norm = normalizeName(p.exercise.name)
      const canonical = resolve(norm)
      if (!map.has(canonical)) {
        map.set(canonical, { count: 0, lastSeen: date, rawNames: new Map() })
      }
      const entry = map.get(canonical)!
      entry.count++
      if (date > entry.lastSeen) entry.lastSeen = date
      entry.rawNames.set(p.exercise.name, (entry.rawNames.get(p.exercise.name) ?? 0) + 1)
    }
  }

  const entries: ExerciseEntry[] = []
  for (const [canonical, data] of map) {
    // Best display name: raw name normalizing to canonical, most frequent
    let displayName = canonical
    let bestCount = 0
    for (const [raw, cnt] of data.rawNames) {
      if (normalizeName(raw) === canonical && cnt > bestCount) {
        displayName = raw
        bestCount = cnt
      }
    }

    const nicknames = Object.entries(aliases)
      .filter(([, to]) => to === canonical)
      .map(([from]) => from)

    entries.push({ norm: canonical, displayName, count: data.count, lastSeen: data.lastSeen, nicknames })
  }

  switch (sort) {
    case 'az':     entries.sort((a, b) => a.displayName.localeCompare(b.displayName)); break
    case 'za':     entries.sort((a, b) => b.displayName.localeCompare(a.displayName)); break
    case 'count':  entries.sort((a, b) => b.count - a.count); break
    case 'recent': entries.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)); break
  }

  return entries
}

function saveAliases(aliases: Record<string, string>): void {
  localStorage.setItem(ALIASES_KEY, JSON.stringify(aliases))
}

export function mergeExercises(
  master: string,
  others: string[],
  aliases: Record<string, string>,
): Record<string, string> {
  const next = { ...aliases }
  for (const other of others) {
    next[other] = master
    // Re-point anything that was already pointing to `other`
    for (const [from, to] of Object.entries(aliases)) {
      if (to === other) next[from] = master
    }
  }
  saveAliases(next)
  return next
}

export function addNickname(
  nickname: string,
  canonical: string,
  aliases: Record<string, string>,
): Record<string, string> {
  const norm = normalizeName(nickname)
  if (!norm || norm === canonical) return aliases
  const next = { ...aliases, [norm]: canonical }
  saveAliases(next)
  return next
}

export function deleteExercise(
  normCanonical: string,
  aliases: Record<string, string>,
): Record<string, string> {
  // All norms that resolve to this canonical
  const toRemove = new Set<string>([normCanonical])
  for (const [from, to] of Object.entries(aliases)) {
    if (to === normCanonical) toRemove.add(from)
  }

  for (const date of getAllDayKeys()) {
    const day = loadDay(date)
    if (!day) continue
    const lines = day.rawText.split('\n')
    const filtered = lines.filter(line => {
      const p = parseLine(line)
      if (!p.exercise?.name) return true
      const norm = normalizeName(p.exercise.name)
      const canonical = aliases[norm] ?? norm
      return !toRemove.has(canonical)
    })
    if (filtered.length !== lines.length) {
      saveDay(date, filtered.join('\n'))
    }
  }

  // Clean up aliases
  const next = { ...aliases }
  for (const norm of toRemove) delete next[norm]
  for (const [from, to] of Object.entries(next)) {
    if (to === normCanonical) delete next[from]
  }
  saveAliases(next)
  return next
}

export function exerciseVolumePerDay(
  normCanonical: string,
  aliases: Record<string, string>,
): Map<string, number> {
  const toMatch = new Set<string>([normCanonical])
  for (const [from, to] of Object.entries(aliases)) {
    if (to === normCanonical) toMatch.add(from)
  }

  const result = new Map<string, number>()
  for (const date of getAllDayKeys()) {
    const day = loadDay(date)
    if (!day) continue
    const bw = getBwOn(date)
    let vol = 0
    for (const line of day.rawText.split('\n')) {
      const p = parseLine(line, bw)
      if (!p.exercise?.name) continue
      const norm = normalizeName(p.exercise.name)
      const canonical = aliases[norm] ?? norm
      if (toMatch.has(canonical)) vol += p.exercise.volume
    }
    if (vol > 0) result.set(date, vol)
  }
  return result
}

/** Total volume for a single day, resolved with the correct bodyweight for that date. */
export function getDayVolume(date: string): number {
  const day = loadDay(date)
  if (!day) return 0
  return totalVolume(day.rawText, getBwOn(date))
}
