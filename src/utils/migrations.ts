import { getAllDayKeys, loadDay, saveDay } from './storage'
import { parseLine } from './parser'

const MIGRATION_KEY = 'migrated_preset_hash_v1'

export function migratePresetNotes(): void {
  if (localStorage.getItem(MIGRATION_KEY)) return

  for (const date of getAllDayKeys()) {
    const day = loadDay(date)
    if (!day) continue

    const migrated = day.rawText
      .split('\n')
      .map(line => {
        const trimmed = line.trim()
        if (trimmed === '') return line
        if (trimmed.startsWith('#')) return line
        const parsed = parseLine(line)
        if (parsed.exercise !== null) return line
        if (parsed.bodyweightEntry !== undefined) return line
        return '# ' + line
      })
      .join('\n')

    if (migrated !== day.rawText) saveDay(date, migrated)
  }

  localStorage.setItem(MIGRATION_KEY, '1')
}
