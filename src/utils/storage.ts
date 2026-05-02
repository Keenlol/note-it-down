export interface DayData {
  date: string
  rawText: string
  savedAt: number
}

const PREFIX = 'workout_'

export function todayKey(): string {
  return dateToKey(new Date())
}

export function dateToKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function saveDay(date: string, rawText: string): void {
  const data: DayData = { date, rawText, savedAt: Date.now() }
  localStorage.setItem(PREFIX + date, JSON.stringify(data))
}

export function loadDay(date: string): DayData | null {
  const item = localStorage.getItem(PREFIX + date)
  return item ? (JSON.parse(item) as DayData) : null
}

export function getAllDayKeys(): string[] {
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(PREFIX)) keys.push(key.slice(PREFIX.length))
  }
  return keys.sort()
}
