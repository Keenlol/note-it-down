import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import {
  getEncouragement, isDayDone, setDayDone, isFinishHintSeen, markFinishHintSeen,
  type Phrase,
} from '../utils/encouragement'
import { todayKey } from '../utils/storage'

interface Props {
  /** The day has something written in it — without that, there is nothing to finish. */
  canFinish: boolean
}

const HOLD_MS = 600
const CONFETTI_MS = 1000
const BITS = 26

// Confetti stays on the app's own palette rather than going full party-store:
// the accent plus the two hues either side of it, and paper white.
const CONFETTI_COLORS = ['var(--accent)', '#eab308', '#22c55e', 'var(--text)']

interface Bit {
  id: number
  style: React.CSSProperties
}

function makeBits(seed: number): Bit[] {
  return Array.from({ length: BITS }, (_, i) => {
    // Fan upward: angles from -170° to -10°, so nothing fires straight down.
    const angle = (-170 + Math.random() * 160) * (Math.PI / 180)
    const dist = 60 + Math.random() * 110
    return {
      id: seed * 1000 + i,
      style: {
        '--dx': `${Math.cos(angle) * dist}px`,
        '--dy': `${Math.sin(angle) * dist * 0.75 + 25}px`,   // a little gravity on the way out
        '--rot': `${(Math.random() - 0.5) * 900}deg`,
        '--delay': `${Math.random() * 90}ms`,
        '--c': CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        width: `${4 + Math.random() * 3}px`,
        height: `${7 + Math.random() * 5}px`,
      } as React.CSSProperties,
    }
  })
}

/**
 * The day's one line of encouragement, and the way a session gets closed out.
 *
 * The phrase does not flip on its own: logging exercises means the work is
 * planned, not finished. Holding the message is the deliberate "I'm done" —
 * it pops, throws confetti, and swaps to the reward phrase for the rest of the
 * day. Holding again takes it back, for a misfire.
 */
export function Encouragement({ canFinish }: Props) {
  const [date] = useState(todayKey)
  const [done, setDone] = useState(() => isDayDone(date))
  const [phrase, setPhrase] = useState<Phrase | null>(
    () => getEncouragement(date, isDayDone(date) ? 'after' : 'before'),
  )
  const [holding, setHolding] = useState(false)
  const [bits, setBits] = useState<Bit[]>([])
  const [hintSeen, setHintSeen] = useState(isFinishHintSeen)

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
    markFinishHintSeen()
    setHintSeen(true)
    navigator.vibrate?.(35)

    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setBits(makeBits(++burstId.current))
      clearTimeout(bitTimer.current)
      bitTimer.current = setTimeout(() => setBits([]), CONFETTI_MS + 200)
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

  const showHint = canFinish && !done && !hintSeen

  return (
    <div className="encouragement">
      {bits.length > 0 && (
        <div className="confetti" aria-hidden="true">
          {bits.map(b => <span key={b.id} className="confetti-bit" style={b.style} />)}
        </div>
      )}

      <button
        key={done ? 'after' : 'before'}
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

      {showHint && <span className="encouragement-hint">hold to finish the day</span>}
    </div>
  )
}
