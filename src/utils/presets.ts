import { getAllDayKeys, loadDay, saveDay } from './storage'
import { parseLine, type ParsedLine } from './parser'
import { getBwOn } from './bodyweight'
import { type SortMode, relativeTime } from './exercises'

export { type SortMode, relativeTime }

const NICKNAMES_KEY = 'nid-preset-nicknames'

export interface PresetBlock {
  headerIndex: number       // line index of the "#" header
  rawContent: string        // content after "#", trimmed (original case)
  norm: string              // rawContent.toLowerCase() — the preset key
  exerciseIndices: number[] // line indices of exercise lines under this header
}

/**
 * Walk a day's parsed lines and yield each preset block: a "#" header plus the
 * exercise lines that follow it until the next header. Bare "#" with no content
 * is skipped. Single source of truth for preset grouping — every preset reader
 * (catalog, history, suggestion, delete) goes through here so the break/collect
 * rules can't drift apart.
 */
export function presetBlocks(parsed: ParsedLine[]): PresetBlock[] {
  const blocks: PresetBlock[] = []
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i]
    if (p.exercise !== null || p.bodyweightEntry !== undefined) continue
    if (!p.raw.trim().startsWith('#')) continue
    const rawContent = p.raw.trim().replace(/^#+\s*/, '')
    if (!rawContent) continue
    const norm = rawContent.toLowerCase()

    const exerciseIndices: number[] = []
    let j = i + 1
    while (j < parsed.length) {
      const next = parsed[j]
      if (next.exercise === null && next.bodyweightEntry === undefined &&
          next.raw.trim().startsWith('#')) break
      if (next.exercise !== null) exerciseIndices.push(j)
      j++
    }
    blocks.push({ headerIndex: i, rawContent, norm, exerciseIndices })
  }
  return blocks
}

export interface PresetEntry {
  norm: string        // normalized key: lowercase content after "#"
  displayName: string // rawContent or overridden nickname
  exercises: string[] // exercise lines from the most recent occurrence
  count: number       // how many times this preset header appeared across all days
  lastSeen: string    // YYYY-MM-DD of most recent occurrence
}

function loadNicknames(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(NICKNAMES_KEY) ?? '{}') } catch { return {} }
}

function saveNicknames(n: Record<string, string>): void {
  localStorage.setItem(NICKNAMES_KEY, JSON.stringify(n))
}

export function setPresetNickname(norm: string, nickname: string): void {
  const next = { ...loadNicknames(), [norm]: nickname.trim() }
  if (!nickname.trim()) delete next[norm]
  saveNicknames(next)
}

export function buildPresetCatalog(sort: SortMode = 'count'): PresetEntry[] {
  const nicknames = loadNicknames()

  // norm → { rawContent (for display when no nickname), exercises from latest day, count, lastSeen }
  const map = new Map<string, {
    rawContent: string
    exercises: string[]
    count: number
    lastSeen: string
  }>()

  // Iterate oldest→newest so the latest occurrence overwrites exercises/rawContent
  for (const date of getAllDayKeys()) { // getAllDayKeys returns sorted ascending
    const day = loadDay(date)
    if (!day) continue
    const lines = day.rawText.split('\n')
    const parsed = lines.map(l => parseLine(l))

    for (const block of presetBlocks(parsed)) {
      const exercises = block.exerciseIndices.map(idx => lines[idx])
      if (exercises.length === 0) continue

      const existing = map.get(block.norm)
      if (existing) {
        existing.count++
        // Overwrite with this date's data if it's newer (or same, since we iterate asc)
        existing.lastSeen = date
        existing.exercises = exercises
        existing.rawContent = block.rawContent
      } else {
        map.set(block.norm, { rawContent: block.rawContent, exercises, count: 1, lastSeen: date })
      }
    }
  }

  const entries: PresetEntry[] = []
  for (const [norm, data] of map) {
    entries.push({
      norm,
      displayName: nicknames[norm] ?? data.rawContent,
      exercises: data.exercises,
      count: data.count,
      lastSeen: data.lastSeen,
    })
  }

  switch (sort) {
    case 'az':     entries.sort((a, b) => a.displayName.localeCompare(b.displayName)); break
    case 'za':     entries.sort((a, b) => b.displayName.localeCompare(a.displayName)); break
    case 'count':  entries.sort((a, b) => b.count - a.count); break
    case 'recent': entries.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)); break
  }

  return entries
}

export interface PresetHistoryEntry {
  date: string
  volume: number   // Σ reps × sets — drives the heatmap accent
  load: number     // Σ weightKg × reps × sets — shown in the history log
}

/**
 * Per-occurrence totals for a preset, newest first. For each day, walks the
 * exercise lines that follow each matching "#" header (until the next header),
 * resolving the correct bodyweight for that date, and accumulates both the
 * volume (reps × sets) and the load (weight × reps × sets).
 */
export function getPresetHistory(norm: string): PresetHistoryEntry[] {
  const byDate = new Map<string, { volume: number; load: number }>()

  for (const date of getAllDayKeys()) {
    const day = loadDay(date)
    if (!day) continue
    const bw = getBwOn(date)
    const parsed = day.rawText.split('\n').map(l => parseLine(l, bw))

    for (const block of presetBlocks(parsed)) {
      if (block.norm !== norm) continue

      let vol = 0
      let load = 0
      for (const idx of block.exerciseIndices) {
        const ex = parsed[idx].exercise!
        vol += ex.volume
        load += ex.weightKg * ex.volume
      }
      if (vol > 0) {
        const acc = byDate.get(date) ?? { volume: 0, load: 0 }
        acc.volume += vol
        acc.load += load
        byDate.set(date, acc)
      }
    }
  }

  return Array.from(byDate, ([date, { volume, load }]) => ({ date, volume, load }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

/** Per-day total volume (reps × sets) for a preset — feeds the heatmap accent highlight. */
export function presetVolumePerDay(norm: string): Map<string, number> {
  const result = new Map<string, number>()
  for (const { date, volume } of getPresetHistory(norm)) result.set(date, volume)
  return result
}

/** Remove the "#" header lines for this preset, keeping the exercise lines below intact. */
export function deletePresetLabelOnly(norm: string): void {
  for (const date of getAllDayKeys()) {
    const day = loadDay(date)
    if (!day) continue
    const lines = day.rawText.split('\n')
    const parsed = lines.map(l => parseLine(l))
    const filtered = lines.filter((line, i) => {
      const p = parsed[i]
      if (p.exercise !== null || p.bodyweightEntry !== undefined) return true
      if (!line.trim().startsWith('#')) return true
      const norm2 = line.trim().replace(/^#+\s*/, '').toLowerCase()
      return norm2 !== norm  // keep lines that are NOT this preset
    })
    if (filtered.length !== lines.length) saveDay(date, filtered.join('\n'))
  }
  const nicks = loadNicknames()
  if (nicks[norm]) { delete nicks[norm]; saveNicknames(nicks) }
}

/** Remove the "#" header lines AND the exercise lines immediately following them. */
export function deletePresetWithExercises(norm: string): void {
  for (const date of getAllDayKeys()) {
    const day = loadDay(date)
    if (!day) continue
    const lines = day.rawText.split('\n')
    const parsed = lines.map(l => parseLine(l))

    const drop = new Set<number>()
    for (const block of presetBlocks(parsed)) {
      if (block.norm !== norm) continue
      drop.add(block.headerIndex)
      for (const idx of block.exerciseIndices) drop.add(idx)
    }

    if (drop.size > 0) {
      saveDay(date, lines.filter((_, i) => !drop.has(i)).join('\n'))
    }
  }
  const nicks = loadNicknames()
  if (nicks[norm]) { delete nicks[norm]; saveNicknames(nicks) }
}
