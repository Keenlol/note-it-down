import { useEffect, useRef } from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft } from 'lucide-react'
import { parseLine, isKnownName, normalizeName, type ParsedLine, type Exercise } from '../utils/parser'

export interface Suggestion {
  suffix: string
  lineIndex: number
  presetLines?: string[]   // set when this is a note-triggered preset block
}

interface Props {
  value: string
  onChange: (text: string) => void
  onCursorChange: (pos: number) => void
  onTabConfirm: () => void
  suggestion: Suggestion | null
  knownPast: Set<string>
  todayCounts: Map<string, number>
  previousExercises: Map<string, Exercise>
  readOnly?: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

function buildTrend(current: Exercise, prev: Exercise): React.ReactNode | null {
  const items: React.ReactNode[] = []

  const setsDiff = current.sets - prev.sets
  if (setsDiff !== 0) {
    const Icon = setsDiff > 0 ? ArrowUp : ArrowDown
    const abs = Math.abs(setsDiff)
    items.push(
      <span key="s" className="trend-item">
        <Icon size={13} strokeWidth={2.5} />
        {abs} set{abs !== 1 ? 's' : ''}
      </span>
    )
  }

  const repsDiff = current.reps - prev.reps
  if (repsDiff !== 0) {
    const Icon = repsDiff > 0 ? ArrowUp : ArrowDown
    const abs = Math.abs(repsDiff)
    items.push(
      <span key="r" className="trend-item">
        <Icon size={13} strokeWidth={2.5} />
        {abs} rep{abs !== 1 ? 's' : ''}
      </span>
    )
  }

  // Skip weight diff when both are bodyweight (both use assumed BW constant)
  const weightDiff = current.weightKg - prev.weightKg
  if (Math.abs(weightDiff) >= 0.5 && !(current.bodyweight && prev.bodyweight)) {
    const Icon = weightDiff > 0 ? ArrowUp : ArrowDown
    const abs = Math.abs(weightDiff)
    const display = abs < 10 ? `${Math.round(abs * 10) / 10}kg` : `${Math.round(abs)}kg`
    items.push(
      <span key="w" className="trend-item">
        <Icon size={13} strokeWidth={2.5} />
        {display}
      </span>
    )
  }

  if (items.length === 0) return null
  return <>{items}</>
}

// Overlay: renders styled text + ghost. Trends are NOT included here —
// they're rendered as separate absolutely-positioned elements on the right.
function renderLine(raw: string, parsed: ParsedLine, isUnknown: boolean): React.ReactNode[] {
  if (raw.length === 0) return []

  const cls: (string | null)[] = new Array(raw.length).fill(null)
  for (const r of parsed.highlights) {
    for (let i = r.start; i < r.end; i++) cls[i] = 'num'
  }
  if (parsed.exercise && isUnknown) {
    for (const r of parsed.nameRanges) {
      for (let i = r.start; i < r.end; i++) {
        if (cls[i] === null) cls[i] = 'unknown-name'
      }
    }
  }

  const out: React.ReactNode[] = []
  let segStart = 0
  for (let i = 1; i <= raw.length; i++) {
    if (i === raw.length || cls[i] !== cls[segStart]) {
      const text = raw.slice(segStart, i)
      const c = cls[segStart]
      out.push(
        c
          ? <span key={segStart} className={c}>{text}</span>
          : <span key={segStart}>{text}</span>
      )
      segStart = i
    }
  }
  return out
}

function renderOverlay(
  text: string,
  suggestion: Suggestion | null,
  knownPast: Set<string>,
  todayCounts: Map<string, number>,
): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []

  lines.forEach((line, i) => {
    if (i > 0) nodes.push('\n')
    const parsed = parseLine(line)
    const unknown = parsed.exercise
      ? !isKnownName(parsed.exercise.name, knownPast, todayCounts)
      : false
    nodes.push(<span key={`l${i}`}>{renderLine(line, parsed, unknown)}</span>)

    // Regular (non-preset) ghost: inline suffix on same line
    if (suggestion?.lineIndex === i && !suggestion.presetLines) {
      nodes.push(
        <span key={`g${i}`} className="ghost">
          {suggestion.suffix}
          <CornerDownLeft size={12} strokeWidth={2} className="ghost-enter-icon" />
        </span>
      )
    }
  })

  return nodes
}

export function Editor({
  value, onChange, onCursorChange, onTabConfirm,
  suggestion, knownPast, todayCounts, previousExercises,
  readOnly, textareaRef,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Auto-resize textarea to content
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }, [value, textareaRef])

  // Compute right-side trend badges for every exercise line that has a prior session
  const lineTrends: { lineIndex: number; node: React.ReactNode }[] = []
  value.split('\n').forEach((line, i) => {
    const parsed = parseLine(line)
    if (!parsed.exercise) return
    const prev = previousExercises.get(normalizeName(parsed.exercise.name))
    if (!prev) return
    const node = buildTrend(parsed.exercise, prev)
    if (node) lineTrends.push({ lineIndex: i, node })
  })

  const reportCursor = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    onCursorChange(e.currentTarget.selectionStart)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      if (suggestion) onTabConfirm()
    }
    if (e.key === 'Enter' && suggestion) {
      e.preventDefault()
      onTabConfirm()
    }
  }

  return (
    <div className="editor-wrap">
      <div ref={overlayRef} className="editor-overlay" aria-hidden="true">
        {renderOverlay(value, suggestion, knownPast, todayCounts)}
        {value.endsWith('\n') || value === '' ? '​' : ''}
      </div>

      {/* Trend badges: floated to the right edge, one per exercise line */}
      {lineTrends.map(({ lineIndex, node }) => (
        <div
          key={lineIndex}
          className="trend-abs"
          aria-hidden="true"
          style={{ top: `calc(${lineIndex} * var(--editor-lh) * 1em)` }}
        >
          <span className="trend">{node}</span>
        </div>
      ))}

      {/* Preset ghost block: positioned below the note line, outside normal text flow */}
      {suggestion?.presetLines && (
        <div
          className="ghost ghost-preset-block"
          aria-hidden="true"
          style={{ top: `calc(${suggestion.lineIndex + 1} * var(--editor-lh) * 1em)` }}
        >
          {suggestion.presetLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <div className="ghost-preset-hint">
            <CornerDownLeft size={11} strokeWidth={2} style={{ verticalAlign: 'middle' }} />
            {' '}enter to fill all
          </div>
        </div>
      )}

      <textarea
        ref={textareaRef}
        className={`editor-textarea${readOnly ? ' read-only' : ''}`}
        value={value}
        onChange={e => {
          onChange(e.target.value)
          onCursorChange(e.target.selectionStart)
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={reportCursor}
        onMouseUp={reportCursor}
        onSelect={reportCursor}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        placeholder=""
      />
    </div>
  )
}
