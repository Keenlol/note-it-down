import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import {
  getEncouragement, isDayDone, setDayDone, type Phrase,
} from '../utils/encouragement'
import { todayKey } from '../utils/storage'

interface Props {
  /** The day has something written in it — without that, there is nothing to finish. */
  canFinish: boolean
}

/** Must stay in step with --hold-ms in index.css, which drives the charge-up. */
const HOLD_MS = 700
const BITS = 56
const CONFETTI_CLEAR_MS = 2800

// Confetti stays on the app's own palette rather than going full party-store:
// the accent plus the two hues either side of it, and paper white.
const CONFETTI_COLORS = ['var(--accent)', '#eab308', '#22c55e', 'var(--text)']

interface Bit {
  id: number
  style: React.CSSProperties
  paper: React.CSSProperties
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo)

/**
 * Two cannons, one per side, firing inward and upward. Horizontal travel is on
 * the outer span and the arc on the inner paper, because a single element can
 * only interpolate one transform — split in two, the X can decelerate while
 * the Y rises and falls.
 */
function makeBits(seed: number): Bit[] {
  return Array.from({ length: BITS }, (_, i) => {
    const fromLeft = i % 2 === 0
    const dur = rand(1.4, 2.2)
    const delay = rand(0, 260)
    return {
      id: seed * 1000 + i,
      style: {
        left: fromLeft ? '-14px' : 'calc(100% + 14px)',
        bottom: `${rand(0, 38)}vh`,
        '--dx': `${(fromLeft ? 1 : -1) * rand(45, 115)}vw`,
        '--dur': `${dur}s`,
        '--delay': `${delay}ms`,
      } as React.CSSProperties,
      paper: {
        '--peak': `${-rand(18, 46)}vh`,
        '--fall': `${rand(8, 60)}vh`,
        '--rot': `${(Math.random() < 0.5 ? -1 : 1) * rand(360, 1440)}deg`,
        '--dur': `${dur}s`,
        '--delay': `${delay}ms`,
        '--c': CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        width: `${rand(5, 9)}px`,
        height: `${rand(8, 14)}px`,
      } as React.CSSProperties,
    }
  })
}

/**
 * The day's one line of encouragement, and the way a session gets closed out.
 *
 * The phrase does not flip on its own: logging exercises means the work is
 * planned, not finished. Holding the message is the deliberate "I'm done" —
 * it winds up, pops, throws confetti and swaps to the reward phrase for the
 * rest of the day. Holding again takes it back, for a misfire.
 */
export function Encouragement({ canFinish }: Props) {
  const [date] = useState(todayKey)
  const [done, setDone] = useState(() => isDayDone(date))
  const [phrase, setPhrase] = useState<Phrase | null>(
    () => getEncouragement(date, isDayDone(date) ? 'after' : 'before'),
  )
  const [holding, setHolding] = useState(false)
  const [bits, setBits] = useState<Bit[]>([])

  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const bitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const burstId = useRef(0)

  useEffect(() => () => {
    clearTimeout(holdTimer.current)
    clearTimeout(bitTimer.current)
  }, [])

  function finish() {
    setDayDone(date, true)
    setDone(true)
    setPhrase(getEncouragement(date, 'after'))
    navigator.vibrate?.(35)

    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setBits(makeBits(++burstId.current))
      clearTimeout(bitTimer.current)
      bitTimer.current = setTimeout(() => setBits([]), CONFETTI_CLEAR_MS)
    }
  }

  function undo() {
    setDayDone(date, false)
    setDone(false)
    setPhrase(getEncouragement(date, 'before'))
  }

  function holdStart() {
    if (!canFinish) return
    setHolding(true)
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => {
      setHolding(false)
      if (done) undo(); else finish()
    }, HOLD_MS)
  }

  function holdEnd() {
    clearTimeout(holdTimer.current)
    setHolding(false)
  }

  if (!phrase) return null

  return (
    <>
      <div className="encouragement-bar">
        {/* Entry and pop live on this wrapper, the wind-up on the button, so
            releasing a hold never restarts the wrapper's animation. */}
        <div
          key={done ? 'after' : 'before'}
          className={`encouragement-anim${done ? ' is-done' : ''}`}
        >
          <button
            type="button"
            className={
              `encouragement-msg${done ? ' is-done' : ''}` +
              `${canFinish ? ' can-finish' : ''}${holding ? ' holding' : ''}`
            }
            onPointerDown={holdStart}
            onPointerUp={holdEnd}
            onPointerLeave={holdEnd}
            onPointerCancel={holdEnd}
            onContextMenu={e => e.preventDefault()}
            aria-label={done ? 'Hold to undo finishing the day' : 'Hold to finish the day'}
          >
            {done && <Check className="encouragement-check" size={13} strokeWidth={2.5} />}
            <span className="encouragement-text">{phrase.text}</span>
            {phrase.author && <span className="encouragement-author">— {phrase.author}</span>}
          </button>
        </div>
      </div>

      {/* Portalled to body: the message sits below the sheets, and the burst has
          to cover everything including them. */}
      {bits.length > 0 && createPortal(
        <div className="confetti" aria-hidden="true">
          {bits.map(b => (
            <span key={b.id} className="confetti-bit" style={b.style}>
              <i className="confetti-paper" style={b.paper} />
            </span>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
