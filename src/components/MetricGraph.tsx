import { windowStart, dayIndex } from '../utils/window'
import { tap } from '../utils/tap'

// SVG canvas in user units; scales to container width via width:100%.
const VB_W = 320
const VB_H = 100
const PAD_X = 14
const PAD_T = 14
const PAD_B = 10

export interface GraphPoint {
  date: string   // YYYY-MM-DD — drives horizontal position within the window
  value: number  // drives vertical position (auto-scaled to the series min/max)
  label: string  // text rendered inside the data-point pill
  gapAfter?: boolean  // break the line between this point and the next
}

interface Plotted { x: number; y: number; label: string; date: string; gapAfter: boolean; dot: boolean }

/**
 * Line + area chart used by the bodyweight and preset panels. Points are placed
 * horizontally by date across the shared 21-week window (so they line up with
 * the heatmap) and vertically by value, auto-scaled to the series range.
 * Tapping a node navigates to that date (via onSelectDate).
 */
export function MetricGraph({ points, accentHex, onSelectDate, minRange = 0 }: {
  points: GraphPoint[]
  accentHex: string
  onSelectDate?: (date: string) => void
  /**
   * Smallest vertical span the plot is allowed to represent. Without it the
   * series always fills the full height, so on a small-integer metric like reps
   * an 8→9 change draws the same dramatic climb as a 60→100kg one. Pass the
   * change size that should look meaningful for the metric; 0 keeps the plot
   * fully auto-scaled.
   */
  minRange?: number
}) {
  const start = windowStart()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const spanDays = Math.max(1, Math.round((today.getTime() - start.getTime()) / 86_400_000))

  const values = points.map(p => p.value)
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (lo === hi) { lo -= 1; hi += 1 }     // flat line → give it vertical room
  // Widen a too-narrow span around its midpoint, so a small change reads as a
  // small change instead of being stretched across the whole plot.
  if (hi - lo < minRange) {
    const mid = (lo + hi) / 2
    lo = mid - minRange / 2
    hi = mid + minRange / 2
  }
  const range = hi - lo

  const plotW = VB_W - PAD_X * 2
  const plotH = VB_H - PAD_T - PAD_B

  const pts: Plotted[] = points.map((p, i) => {
    const x = PAD_X + (dayIndex(p.date, start) / spanDays) * plotW
    const y = PAD_T + (1 - (p.value - lo) / range) * plotH
    // A repeated value plots at the identical height, so a run of them stacks
    // its pills into an unreadable pile. Only the leftmost of each run keeps
    // its pill; the rest collapse to dots. A changed value — or a gap, which
    // starts a fresh segment — begins a new run and so gets a pill again.
    const prev = points[i - 1]
    const dot = prev !== undefined && prev.value === p.value && prev.gapAfter !== true
    return { x, y, label: p.label, date: p.date, gapAfter: p.gapAfter === true, dot }
  })

  // Split into contiguous runs: a point flagged gapAfter ends its run, so a
  // session where the exercise wasn't done shows as a break rather than being
  // drawn through (which would read as a straight line across missing data).
  const segments: Plotted[][] = []
  let run: Plotted[] = []
  for (const p of pts) {
    run.push(p)
    if (p.gapAfter) { segments.push(run); run = [] }
  }
  if (run.length > 0) segments.push(run)

  const pathOf = (seg: Plotted[]) =>
    seg.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')

  return (
    <div className="bw-graph">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="bw-graph-svg">
        {segments.map((seg, i) => seg.length > 1 && (
          <polygon
            key={`a${i}`}
            points={`${seg[0].x.toFixed(1)},${VB_H - PAD_B} ${pathOf(seg)} ${seg[seg.length - 1].x.toFixed(1)},${VB_H - PAD_B}`}
            fill="var(--accent-tint)"
          />
        ))}
        {segments.map((seg, i) => seg.length > 1 && (
          <polyline
            key={`l${i}`}
            points={pathOf(seg)}
            fill="none"
            stroke={accentHex}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="bw-graph-nodes">
        {pts.map((p, i) => (
          <span
            key={i}
            className={`bw-node${p.dot ? ' is-dot' : ''}`}
            style={{ left: `${(p.x / VB_W) * 100}%`, top: `${(p.y / VB_H) * 100}%`, background: accentHex }}
            title={p.dot ? p.label : undefined}
            onPointerDown={tap}
            // Stop here so tapping a node jumps to that date without also
            // toggling the expandable row the graph may sit inside.
            onClick={e => { e.stopPropagation(); onSelectDate?.(p.date) }}
          >
            {p.dot ? null : p.label}
          </span>
        ))}
      </div>
    </div>
  )
}
