import { windowStart, dayIndex } from '../utils/window'

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
}

interface Plotted { x: number; y: number; label: string }

/**
 * Line + area chart used by the bodyweight and preset panels. Points are placed
 * horizontally by date across the shared 21-week window (so they line up with
 * the heatmap) and vertically by value, auto-scaled to the series range.
 */
export function MetricGraph({ points, accentHex }: { points: GraphPoint[]; accentHex: string }) {
  const start = windowStart()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const spanDays = Math.max(1, Math.round((today.getTime() - start.getTime()) / 86_400_000))

  const values = points.map(p => p.value)
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (lo === hi) { lo -= 1; hi += 1 }     // flat line → give it vertical room
  const range = hi - lo

  const plotW = VB_W - PAD_X * 2
  const plotH = VB_H - PAD_T - PAD_B

  const pts: Plotted[] = points.map(p => {
    const x = PAD_X + (dayIndex(p.date, start) / spanDays) * plotW
    const y = PAD_T + (1 - (p.value - lo) / range) * plotH
    return { x, y, label: p.label }
  })

  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = pts.length > 1
    ? `${pts[0].x.toFixed(1)},${VB_H - PAD_B} ${line} ${pts[pts.length - 1].x.toFixed(1)},${VB_H - PAD_B}`
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
            {p.label}
          </span>
        ))}
      </div>
    </div>
  )
}
