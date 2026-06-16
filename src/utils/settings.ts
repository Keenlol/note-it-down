// ── Weight unit ──────────────────────────────────────────────────────────────

export type WeightUnit = 'kg' | 'lbs'

const WEIGHT_UNIT_KEY = 'settings_weightUnit'
const KG_PER_LB = 0.453592

export function getSavedWeightUnit(): WeightUnit {
  return (localStorage.getItem(WEIGHT_UNIT_KEY) as WeightUnit | null) ?? 'kg'
}

export function saveWeightUnit(unit: WeightUnit) {
  localStorage.setItem(WEIGHT_UNIT_KEY, unit)
}

/** Format a stored-kg value for display in the user's preferred unit. */
export function formatWeightDisplay(kg: number, unit: WeightUnit): string {
  if (unit === 'lbs') {
    const lbs = kg / KG_PER_LB
    const r = Math.round(lbs * 10) / 10
    return r % 1 === 0 ? `${Math.round(lbs)}lbs` : `${r}lbs`
  }
  return kg % 1 === 0 ? `${kg}kg` : `${Math.round(kg * 10) / 10}kg`
}

/** Format an absolute kg difference for display (used in trend chips). */
export function formatWeightDiff(absKgDiff: number, unit: WeightUnit): string {
  const val = unit === 'lbs' ? absKgDiff / KG_PER_LB : absKgDiff
  const r = Math.round(val * 10) / 10
  const display = r < 10 ? `${r}` : `${Math.round(val)}`
  return `${display}${unit}`
}

// ── Bottom-sheet height (user-resizable, remembered) ──────────────────────────

const SHEET_HEIGHT_KEY = 'settings_sheetHeight'

export function getSavedSheetHeight(): number | undefined {
  const v = localStorage.getItem(SHEET_HEIGHT_KEY)
  return v ? Number(v) : undefined
}

export function saveSheetHeight(px: number): void {
  localStorage.setItem(SHEET_HEIGHT_KEY, String(Math.round(px)))
}

// ── Accent color ──────────────────────────────────────────────────────────────

export const ACCENT_COLORS = [
  { key: 'red',    label: 'Red',    hex: '#ef4444' },
  { key: 'orange', label: 'Orange', hex: '#f97316' },
  { key: 'yellow', label: 'Yellow', hex: '#eab308' },
  { key: 'green',  label: 'Green',  hex: '#22c55e' },
  { key: 'blue',   label: 'Blue',   hex: '#3b82f6' },
  { key: 'purple', label: 'Purple', hex: '#8b5cf6' },
  { key: 'pink',   label: 'Pink',   hex: '#ec4899' },
] as const

export type AccentKey = typeof ACCENT_COLORS[number]['key']

const ACCENT_STORAGE_KEY = 'settings_accent'

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r},${g},${b}`
}

/** Write all four accent CSS variables onto :root */
export function applyAccent(hex: string) {
  const rgb = hexToRgb(hex)
  const root = document.documentElement
  root.style.setProperty('--accent',      hex)
  root.style.setProperty('--accent-dim',  `rgba(${rgb},0.45)`)
  root.style.setProperty('--accent-mid',  `rgba(${rgb},0.28)`)
  root.style.setProperty('--accent-tint', `rgba(${rgb},0.12)`)
}

export function getSavedAccent(): AccentKey {
  return (localStorage.getItem(ACCENT_STORAGE_KEY) as AccentKey | null) ?? 'orange'
}

export function saveAndApplyAccent(key: AccentKey) {
  const def = ACCENT_COLORS.find(c => c.key === key)!
  applyAccent(def.hex)
  localStorage.setItem(ACCENT_STORAGE_KEY, key)
}
