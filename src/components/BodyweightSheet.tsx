import { useMemo } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { loadBwHistory, type BwEntry } from '../utils/bodyweight'
import { formatWeightDisplay, formatWeightDiff, type WeightUnit } from '../utils/settings'
import { todayKey } from '../utils/storage'
import { SheetHandle } from './SheetHandle'

interface Props {
  open: boolean
  onClose: () => void
  dataVersion: number
  bwVersion: number
  height?: number
  onResize: (height: number) => void
  onResizeEnd: () => void
  weightUnit?: WeightUnit
}

const KG_PER_LB = 0.453592
// Same window the heatmap renders, so highlighted cells line up with the graph.
const WEEKS = 21

const POS_COLOR = 'rgb(45, 149, 47)'
const NEG_COLOR = 'rgb(200, 57, 57)'
const POS_BG    = 'rgba(45, 149, 47, 0.1)'
const NEG_BG    = 'rgba(200, 57, 57, 0.1)'

// SVG canvas in user units; scales to container width via width:100%.
const VB_W = 320
const VB_H = 100
const PAD_X = 14
const PAD_T = 14
const PAD_B = 10

/** First day of the 21-week heatmap window (Sunday-aligned), at local midnight. */
function windowStart(): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(today.getDate() - (WEEKS - 1) * 7 - today.getDay())
  return start
}

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

function dayIndex(dateStr: string, start: Date): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return Math.round((date.getTime() - start.getTime()) / 86_400_000)
}

interface Plotted { x: number; y: number; entry: BwEntry }

function BwGraph({ entries, unit, accentHex }: { entries: BwEntry[]; unit: WeightUnit; accentHex: string }) {
  const start = windowStart()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const spanDays = Math.max(1, Math.round((today.getTime() - start.getTime()) / 86_400_000))

  const values = entries.map(e => toUnit(e.weight, unit))
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (lo === hi) { lo -= 1; hi += 1 }     // flat line → give it vertical room
  const range = hi - lo

  const plotW = VB_W - PAD_X * 2
  const plotH = VB_H - PAD_T - PAD_B

  const pts: Plotted[] = entries.map((entry, i) => {
    const x = PAD_X + (dayIndex(entry.date, start) / spanDays) * plotW
    const y = PAD_T + (1 - (values[i] - lo) / range) * plotH
    return { x, y, entry }
  })

  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = pts.length > 1
    ? `${PAD_X + (dayIndex(pts[0].entry.date, start) / spanDays) * plotW},${VB_H - PAD_B} ` +
      line +
      ` ${PAD_X + (dayIndex(pts[pts.length - 1].entry.date, start) / spanDays) * plotW},${VB_H - PAD_B}`
    : ''

  return (
    <div className="bw-graph">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="bw-graph-svg">
        {pts.length > 1 && (
          <polygon points={area} fill="var(--accent-tint)" />
        )}
        {pts.length > 1 && (
          <polyline
            points={line}
            fill="none"
            stroke={accentHex}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="bw-graph-nodes">
        {pts.map((p, i) => (
          <span
            key={i}
            className="bw-node"
            style={{ left: `${(p.x / VB_W) * 100}%`, top: `${(p.y / VB_H) * 100}%`, background: accentHex }}
          >
            {compactWeight(p.entry.weight, unit)}
          </span>
        ))}
      </div>
    </div>
  )
}

function BwHistoryList({ entries, unit }: { entries: BwEntry[]; unit: WeightUnit }) {
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
          <div key={entry.date} className="history-entry">
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

export function BodyweightSheet({ open, onClose, dataVersion, bwVersion, height, onResize, onResizeEnd, weightUnit = 'kg' }: Props) {
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
              <BwGraph entries={windowEntries} unit={weightUnit} accentHex={accentHex} />
              <BwHistoryList entries={windowEntries} unit={weightUnit} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
