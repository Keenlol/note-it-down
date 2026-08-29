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

/** Convert a stored-kg value to a bare number in the user's preferred unit. */
export function toDisplayWeight(kg: number, unit: WeightUnit): number {
  return unit === 'lbs' ? kg / KG_PER_LB : kg
}

/** Format an absolute kg difference for display (used in trend chips). */
export function formatWeightDiff(absKgDiff: number, unit: WeightUnit): string {
  const val = unit === 'lbs' ? absKgDiff / KG_PER_LB : absKgDiff
  const r = Math.round(val * 10) / 10
  const display = r < 10 ? `${r}` : `${Math.round(val)}`
  return `${display}${unit}`
}

// ── Trend badges ──────────────────────────────────────────────────────────────

const SHOW_DOWN_TREND_KEY = 'settings_showDownTrend'

/** Whether downward trend badges are shown at all. Defaults to on. */
export function getSavedShowDownTrend(): boolean {
  return localStorage.getItem(SHOW_DOWN_TREND_KEY) !== 'off'
}

export function saveShowDownTrend(show: boolean) {
  localStorage.setItem(SHOW_DOWN_TREND_KEY, show ? 'on' : 'off')
}

// ── Preset graph metric ───────────────────────────────────────────────────────

/** Which figure the per-exercise graphs in the preset panel plot. */
export type PresetMetric = 'load' | 'weight' | 'reps' | 'sets'

const PRESET_METRIC_KEY = 'settings_presetMetric'

const PRESET_METRICS: PresetMetric[] = ['load', 'weight', 'reps', 'sets']

export function getSavedPresetMetric(): PresetMetric {
  const v = localStorage.getItem(PRESET_METRIC_KEY) as PresetMetric | null
  return v && PRESET_METRICS.includes(v) ? v : 'load'
}

export function savePresetMetric(metric: PresetMetric): void {
  localStorage.setItem(PRESET_METRIC_KEY, metric)
}

// ── AI export range ───────────────────────────────────────────────────────────

/** How far back the AI-report export reaches. */
export type AiRange = '1m' | '3m' | '1y' | 'all'

const AI_RANGE_KEY = 'settings_aiRange'

const AI_RANGES: AiRange[] = ['1m', '3m', '1y', 'all']

export function getSavedAiRange(): AiRange {
  const v = localStorage.getItem(AI_RANGE_KEY) as AiRange | null
  return v && AI_RANGES.includes(v) ? v : '3m'
}

export function saveAiRange(range: AiRange): void {
  localStorage.setItem(AI_RANGE_KEY, range)
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

// ── Heatmap corner rounding ───────────────────────────────────────────────────

/* Stored as a percentage of the cell's own size, not a pixel radius: cells are
   flex-sized, so a fixed radius would read differently on a phone than on a
   wide screen. 50 is already a full circle — the scale runs past it so the top
   of the slider is unambiguously round rather than "almost". */
export const HEAT_ROUND_MIN = 0
export const HEAT_ROUND_MAX = 60
export const HEAT_ROUND_DEFAULT = 24   // ≈ the 3px radius the grid shipped with

const HEAT_ROUND_KEY = 'settings_heatRound'

/** Write the rounding onto :root; the grid and its selection ring derive from it. */
export function applyHeatRound(pct: number) {
  document.documentElement.style.setProperty('--heat-round', String(pct))
}

export function getSavedHeatRound(): number {
  const raw = localStorage.getItem(HEAT_ROUND_KEY)
  if (raw === null) return HEAT_ROUND_DEFAULT
  const v = Number(raw)
  return Number.isFinite(v) && v >= HEAT_ROUND_MIN && v <= HEAT_ROUND_MAX ? v : HEAT_ROUND_DEFAULT
}

export function saveAndApplyHeatRound(pct: number) {
  applyHeatRound(pct)
  localStorage.setItem(HEAT_ROUND_KEY, String(pct))
}
