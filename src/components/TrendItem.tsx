import { ArrowDown, ArrowUp } from 'lucide-react'

// Improvements are green; declines are deliberately neutral grey, not red.
// A red "you went down" badge pressures people into either not deloading or
// logging a number they didn't hit — the badge should report, not judge.
const POS_COLOR = 'rgb(45, 149, 47)'
const POS_BG    = 'rgba(45, 149, 47, 0.1)'
const NEG_COLOR = 'rgb(140, 140, 140)'
const NEG_BG    = 'rgba(140, 140, 140, 0.1)'

interface Props {
  /** Signed change. Sign picks the arrow + color; magnitude is not read. */
  diff: number
  /** Formatted label, e.g. "3 sets" or "2.5kg". */
  children: React.ReactNode
  /** Icon size: 13 in the editor gutter, 11 inside sheet history rows. */
  size?: number
  /**
   * When false, downward badges render nothing at all. Wired to the
   * "Downward trends" setting. Leave true for metrics where a decrease
   * isn't a regression (e.g. bodyweight).
   */
  showDown?: boolean
}

/**
 * The single trend badge used everywhere (editor gutter, exercise history,
 * preset volume, bodyweight). Renders nothing for a zero — or suppressed —
 * change, so callers can drop it in without their own guard.
 */
export function TrendItem({ diff, children, size = 11, showDown = true }: Props) {
  if (diff === 0) return null
  const up = diff > 0
  if (!up && !showDown) return null
  const Icon = up ? ArrowUp : ArrowDown
  return (
    <span
      className="trend-item"
      style={{ color: up ? POS_COLOR : NEG_COLOR, background: up ? POS_BG : NEG_BG }}
    >
      <Icon size={size} strokeWidth={2.5} />{children}
    </span>
  )
}
