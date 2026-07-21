import { type Exercise } from '../utils/parser'
import { type HistoryEntry } from '../utils/exercises'
import { type WeightUnit, formatWeightDisplay, formatWeightDiff } from '../utils/settings'
import { TrendItem } from './TrendItem'
import { tap } from '../utils/tap'

function buildTrend(curr: Exercise, prev: Exercise, unit: WeightUnit, showDown: boolean): React.ReactNode | null {
  // Skip weight diff when both are plain bodyweight (same resolved weight means same bw day)
  const rawWeight = curr.weightKg - prev.weightKg
  const bothPlainBw = curr.bwExpr?.op === 'plain' && prev.bwExpr?.op === 'plain'
  const wDiff = Math.abs(rawWeight) >= 0.5 && !bothPlainBw ? rawWeight : 0

  const sDiff = curr.sets - prev.sets
  const rDiff = curr.reps - prev.reps

  const parts: { key: string; diff: number; label: React.ReactNode }[] = [
    { key: 's', diff: sDiff, label: `${Math.abs(sDiff)} set${Math.abs(sDiff) !== 1 ? 's' : ''}` },
    { key: 'r', diff: rDiff, label: `${Math.abs(rDiff)} rep${Math.abs(rDiff) !== 1 ? 's' : ''}` },
    { key: 'w', diff: wDiff, label: formatWeightDiff(Math.abs(wDiff), unit) },
  ].filter(p => p.diff !== 0 && (p.diff > 0 || showDown))

  if (parts.length === 0) return null
  return <>{parts.map(p => (
    <TrendItem key={p.key} diff={p.diff}>{p.label}</TrendItem>
  ))}</>
}

function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const now = new Date()
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return date.toLocaleDateString('en-US', opts)
}

/**
 * Newest-first log of an exercise: date, weight × reps × sets, and the change
 * against the entry below it. Shared by the exercise catalog and the preset
 * panel so both read the same way — the preset panel passes only the
 * occurrences logged under that preset.
 */
export function ExerciseHistoryList({
  entries, unit, showDownTrend, onSelectDate, className = 'history-list',
}: {
  entries: HistoryEntry[]
  unit: WeightUnit
  showDownTrend: boolean
  onSelectDate: (date: string) => void
  className?: string
}) {
  if (entries.length === 0) {
    return <div className="history-empty">No entries found.</div>
  }
  return (
    <div className={className}>
      {entries.map((entry, i) => {
        const prev = entries[i + 1]
        const trend = prev ? buildTrend(entry.exercise, prev.exercise, unit, showDownTrend) : null
        return (
          <div
            key={`${entry.date}-${i}`}
            className="history-entry"
            onPointerDown={tap}
            onClick={() => onSelectDate(entry.date)}
          >
            <span className="history-date">{shortDate(entry.date)}</span>
            <span className="history-values">
              <span className="num">{formatWeightDisplay(entry.exercise.weightKg, unit)}</span>
              <span className="history-sep"> × </span>
              <span className="num">{entry.exercise.reps}</span>
              <span className="history-sep"> × </span>
              <span className="num">{entry.exercise.sets}</span>
            </span>
            {trend && <span className="history-trend">{trend}</span>}
          </div>
        )
      })}
    </div>
  )
}
