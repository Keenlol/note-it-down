import { useMemo } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { loadBwHistory, type BwEntry } from '../utils/bodyweight'
import { formatWeightDisplay, formatWeightDiff, type WeightUnit } from '../utils/settings'
import { todayKey } from '../utils/storage'
import { windowStart, dayIndex } from '../utils/window'
import { tap } from '../utils/tap'
import { MetricGraph } from './MetricGraph'
import { SheetHandle } from './SheetHandle'

interface Props {
  open: boolean
  onClose: () => void
  onSelectDate: (date: string) => void
  dataVersion: number
  bwVersion: number
  height?: number
  onResize: (height: number) => void
  onResizeEnd: () => void
  weightUnit?: WeightUnit
}

const KG_PER_LB = 0.453592

const POS_COLOR = 'rgb(45, 149, 47)'
const NEG_COLOR = 'rgb(200, 57, 57)'
const POS_BG    = 'rgba(45, 149, 47, 0.1)'
const NEG_BG    = 'rgba(200, 57, 57, 0.1)'

function toUnit(kg: number, unit: WeightUnit): number {
  return unit === 'lbs' ? kg / KG_PER_LB : kg
}

/** Compact numeric weight (no unit suffix) for the per-point graph labels. */
function compactWeight(kg: number, unit: WeightUnit): string {
  const v = toUnit(kg, unit)
  const r = Math.round(v * 10) / 10
  return r % 1 === 0 ? `${Math.round(v)}` : `${r}`
}

function daysAgoLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((today.getTime() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'measured today'
  if (days === 1) return 'measured yesterday'
  return `measured ${days} days ago`
}

function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const now = new Date()
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return date.toLocaleDateString('en-US', opts)
}


function BwHistoryList({ entries, unit, onSelectDate }: { entries: BwEntry[]; unit: WeightUnit; onSelectDate: (date: string) => void }) {
  // Newest first for the list.
  const ordered = [...entries].reverse()
  return (
    <div className="history-list bw-history-list">
      {ordered.map((entry, i) => {
        const prev = ordered[i + 1]
        const diff = prev ? entry.weight - prev.weight : 0
        const shown = Math.round(toUnit(Math.abs(diff), unit) * 10) / 10
        const Icon = diff > 0 ? ArrowUp : ArrowDown
        return (
          <div
            key={entry.date}
            className="history-entry"
            onPointerDown={tap}
            onClick={() => onSelectDate(entry.date)}
          >
            <span className="history-date">{shortDate(entry.date)}</span>
            <span className="history-values">
              <span className="num">{formatWeightDisplay(entry.weight, unit)}</span>
            </span>
            {prev && shown !== 0 && (
              <span className="history-trend">
                <span
                  className="trend-item"
                  style={{ color: diff > 0 ? POS_COLOR : NEG_COLOR, background: diff > 0 ? POS_BG : NEG_BG }}
                >
                  <Icon size={11} strokeWidth={2.5} />{formatWeightDiff(Math.abs(diff), unit)}
                </span>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function BodyweightSheet({ open, onClose, onSelectDate, dataVersion, bwVersion, height, onResize, onResizeEnd, weightUnit = 'kg' }: Props) {
  const accentHex = useMemo(
    () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f97316',
    [open],
  )

  // Entries within the visible heatmap window, oldest → newest.
  const windowEntries = useMemo(() => {
    const start = windowStart()
    const today = todayKey()
    return loadBwHistory().filter(e => dayIndex(e.date, start) >= 0 && e.date <= today)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bwVersion, dataVersion, open])

  const latest = windowEntries[windowEntries.length - 1]
  const first  = windowEntries[0]
  const netDiff = latest && first ? latest.weight - first.weight : 0

  return (
    <div
      className={`exercise-sheet${open ? ' open' : ''}`}
      style={height !== undefined ? { height: `${height}px` } : undefined}
    >
      <SheetHandle onClose={onClose} onResize={onResize} onResizeEnd={onResizeEnd} />

      <div className="sheet-header">
        <div className="sheet-title-row">
          <span className="sheet-title">Bodyweight</span>
        </div>
      </div>

      <div className="bw-body">
        {windowEntries.length === 0 ? (
          <p className="exercise-empty">
            No bodyweight logged in this window. Add a line like <span className="num">bodyweight 82</span> in your notes.
          </p>
        ) : (
          <>
            <div className="data-stat-card">
              <div className="data-stat-size">
                <span className="data-stat-size-value">{formatWeightDisplay(latest.weight, weightUnit)}</span>
                <span className="data-stat-size-label">{daysAgoLabel(latest.date)}</span>
              </div>
              <div className="data-stat-counts">
                <span className="data-stat-count"><strong>{windowEntries.length}</strong> entries</span>
                {first && latest && first.date !== latest.date && (
                  <span className="data-stat-count">
                    <strong>{netDiff > 0 ? '+' : netDiff < 0 ? '−' : ''}{formatWeightDiff(Math.abs(netDiff), weightUnit)}</strong> over window
                  </span>
                )}
              </div>
            </div>

            <div className="bw-block">
              <MetricGraph
                points={windowEntries.map(e => ({
                  date: e.date,
                  value: toUnit(e.weight, weightUnit),
                  label: compactWeight(e.weight, weightUnit),
                }))}
                accentHex={accentHex}
              />
              <BwHistoryList entries={windowEntries} unit={weightUnit} onSelectDate={onSelectDate} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
