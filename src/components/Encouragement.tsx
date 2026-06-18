import { useState } from 'react'
import { getEncouragement, type Phase } from '../utils/encouragement'
import { todayKey } from '../utils/storage'

interface Props {
  phase: Phase
}

// One daily line of encouragement, shown on Today's view.
// `phase` flips from 'before' to 'after' once the first exercise is logged,
// turning the greeting into a reward. Resolved once per mount so the pool
// cursor advances exactly when the phrase is surfaced.
export function Encouragement({ phase }: Props) {
  const [phrase] = useState(() => getEncouragement(todayKey(), phase))
  if (!phrase) return null

  return (
    <div className={`encouragement encouragement-${phase}`} key={phase}>
      <span className="encouragement-text">{phrase.text}</span>
      {phrase.author && <span className="encouragement-author">— {phrase.author}</span>}
    </div>
  )
}
