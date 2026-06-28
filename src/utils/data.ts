import { getAllDayKeys, loadDay, saveDay, type DayData } from './storage'
import { loadAliases } from './aliases'
import { parseLine, normalizeName } from './parser'
import { invalidateBwCache } from './bodyweight'

// ── Keys ─────────────────────────────────────────────────────────────────────

const WORKOUT_PREFIX   = 'workout_'
const ALIASES_KEY      = 'nid-aliases'
const NICKNAMES_KEY    = 'nid-preset-nicknames'
const BW_KEY           = 'nid-bodyweight'
const WORKOUT_KEYS     = [ALIASES_KEY, NICKNAMES_KEY, BW_KEY]

function isWorkoutKey(k: string) {
  return k.startsWith(WORKOUT_PREFIX) || WORKOUT_KEYS.includes(k)
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface DataStats {
  entryCount:   number   // days with logged data
  exerciseCount: number  // unique canonical exercise names
  presetCount:  number   // unique preset headers
  sizeBytes:    number   // approximate size of all workout data
}

export function getDataStats(): DataStats {
  const dayKeys = getAllDayKeys()
  const aliases = loadAliases()

  // Count unique exercises across all days
  const exerciseSet = new Set<string>()
  // Count unique preset keys across all days
  const presetSet = new Set<string>()

  for (const date of dayKeys) {
    const day = loadDay(date)
    if (!day) continue
    const lines = day.rawText.split('\n')
    const parsed = lines.map(l => parseLine(l))

    for (let i = 0; i < parsed.length; i++) {
      const p = parsed[i]
      if (p.exercise?.name) {
        const norm = normalizeName(p.exercise.name)
        exerciseSet.add(aliases[norm] ?? norm)
      }
      // Preset: non-exercise line starting with '#' that has exercises below it
      if (!p.exercise && p.bodyweightEntry === undefined && p.raw.trim().startsWith('#')) {
        const content = p.raw.trim().replace(/^#+\s*/, '').toLowerCase()
        if (content) presetSet.add(content)
      }
    }
  }

  // Size: sum of all workout-related localStorage entries (UTF-16, ~2 bytes/char)
  let chars = 0
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    if (isWorkoutKey(k)) chars += k.length + (localStorage.getItem(k)?.length ?? 0)
  }

  return {
    entryCount:    dayKeys.length,
    exerciseCount: exerciseSet.size,
    presetCount:   presetSet.size,
    sizeBytes:     chars * 2,
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Export ────────────────────────────────────────────────────────────────────

export interface ExportBundle {
  version:        1
  exportedAt:     string
  days:           Record<string, DayData>
  aliases:        Record<string, string>
  presetNicknames: Record<string, string>
  bodyweight:     unknown
}

export function exportData(): void {
  const days: Record<string, DayData> = {}
  for (const date of getAllDayKeys()) {
    const d = loadDay(date)
    if (d) days[date] = d
  }

  const bundle: ExportBundle = {
    version:        1,
    exportedAt:     new Date().toISOString(),
    days,
    aliases:        JSON.parse(localStorage.getItem(ALIASES_KEY)  ?? '{}'),
    presetNicknames: JSON.parse(localStorage.getItem(NICKNAMES_KEY) ?? '{}'),
    bodyweight:     JSON.parse(localStorage.getItem(BW_KEY)        ?? '[]'),
  }

  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `note-it-down-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Import ────────────────────────────────────────────────────────────────────

export interface ImportSummary {
  dayCount:  number
  rawBundle: ExportBundle
}

export function parseImportFile(json: string): ImportSummary {
  const bundle = JSON.parse(json) as ExportBundle
  if (bundle.version !== 1) throw new Error('Unsupported export version')
  return { dayCount: Object.keys(bundle.days).length, rawBundle: bundle }
}

export function applyImport(bundle: ExportBundle, mode: 'add' | 'replace'): void {
  if (mode === 'replace') clearData()

  // Days: in add mode, existing day wins (don't overwrite user's current data)
  for (const [date, day] of Object.entries(bundle.days)) {
    if (mode === 'replace' || !loadDay(date)) {
      saveDay(date, day.rawText)
    }
  }

  // Aliases: merge, existing wins in add mode
  if (mode === 'replace') {
    localStorage.setItem(ALIASES_KEY, JSON.stringify(bundle.aliases))
  } else {
    const existing = loadAliases()
    localStorage.setItem(ALIASES_KEY, JSON.stringify({ ...bundle.aliases, ...existing }))
  }

  // Preset nicknames: same strategy
  const existingNick = JSON.parse(localStorage.getItem(NICKNAMES_KEY) ?? '{}')
  if (mode === 'replace') {
    localStorage.setItem(NICKNAMES_KEY, JSON.stringify(bundle.presetNicknames))
  } else {
    localStorage.setItem(NICKNAMES_KEY, JSON.stringify({ ...bundle.presetNicknames, ...existingNick }))
  }

  // Bodyweight: replace always wins; in add mode, keep existing
  if (mode === 'replace') {
    localStorage.setItem(BW_KEY, JSON.stringify(bundle.bodyweight))
    invalidateBwCache()  // we wrote BW_KEY directly, bypassing saveBwHistoryRaw
  }
  // add mode: keep existing bodyweight unchanged
}

// ── Clear ─────────────────────────────────────────────────────────────────────

export function clearData(): void {
  const toRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    if (isWorkoutKey(k)) toRemove.push(k)
  }
  toRemove.forEach(k => localStorage.removeItem(k))
}
