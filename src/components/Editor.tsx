import { useEffect, useRef } from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft } from 'lucide-react'
import { parseLine, isKnownName, normalizeName, type ParsedLine, type Exercise } from '../utils/parser'
import { type WeightUnit, formatWeightDiff } from '../utils/settings'

export interface Suggestion {
  suffix: string
  lineIndex: number
  presetLines?: string[]   // set when this is a note-triggered preset block
  nameSuffix?: string      // inline ghost for preset name completion (Case B)
  isHint?: boolean         // true = show-all mode, don't intercept Enter
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
  bodyweightKg?: number   // actual bodyweight for this date; defaults to 60
  bwIsSet?: boolean       // false → show "set bodyweight" hint on bw lines
  reveal?: boolean
  readOnly?: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  weightUnit?: WeightUnit
}

const POS_COLOR = 'rgb(45, 149, 47)'    // green – improvement
const NEG_COLOR = 'rgb(200, 57, 57)'   // red   – decline
const POS_BG    = 'rgba(45, 149, 47, 0.1)'
const NEG_BG    = 'rgba(200, 57, 57, 0.1)'

function buildTrend(current: Exercise, prev: Exercise, unit: WeightUnit): React.ReactNode | null {
  const items: React.ReactNode[] = []

  const setsDiff = current.sets - prev.sets
  if (setsDiff !== 0) {
    const Icon = setsDiff > 0 ? ArrowUp : ArrowDown
    const abs = Math.abs(setsDiff)
    items.push(
      <span key="s" className="trend-item" style={{ color: setsDiff > 0 ? POS_COLOR : NEG_COLOR, background: setsDiff > 0 ? POS_BG : NEG_BG }}>
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
      <span key="r" className="trend-item" style={{ color: repsDiff > 0 ? POS_COLOR : NEG_COLOR, background: repsDiff > 0 ? POS_BG : NEG_BG }}>
        <Icon size={13} strokeWidth={2.5} />
        {abs} rep{abs !== 1 ? 's' : ''}
      </span>
    )
  }

  // Skip weight diff when both are bodyweight (both use assumed BW constant)
  const weightDiff = current.weightKg - prev.weightKg
  if (Math.abs(weightDiff) >= 0.5 && !(current.bodyweight && prev.bodyweight)) {
    const Icon = weightDiff > 0 ? ArrowUp : ArrowDown
    items.push(
      <span key="w" className="trend-item" style={{ color: weightDiff > 0 ? POS_COLOR : NEG_COLOR, background: weightDiff > 0 ? POS_BG : NEG_BG }}>
        <Icon size={13} strokeWidth={2.5} />
        {formatWeightDiff(Math.abs(weightDiff), unit)}
      </span>
    )
  }

  if (items.length === 0) return null
  return <>{items}</>
}

// Reveal overlay: exercise lines show formatted values (all orange), non-exercise lines render normally.
// This is a second overlay that crossfades over the normal one on hold.
function renderRevealOverlay(text: string, bodyweightKg: number, unit: WeightUnit): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []

  lines.forEach((line, i) => {
    if (i > 0) nodes.push('\n')
    const parsed = parseLine(line, bodyweightKg)
    if (parsed.bodyweightEntry !== undefined) {
      // Show bodyweight entry lines as-is with the number orange
      nodes.push(
        <span key={i}>
          {line.slice(0, parsed.highlights[0]?.start ?? line.length)}
          <span className="num">{line.slice(parsed.highlights[0]?.start, parsed.highlights[0]?.end)}</span>
          {line.slice(parsed.highlights[0]?.end ?? line.length)}
        </span>
      )
    } else if (parsed.exercise) {
      const ex = parsed.exercise
      // Separate the numeric value from its unit label so the label
      // gets reveal-unit styling (dimmed) matching "reps x" and "sets".
      const KG_PER_LB = 0.453592
      const wVal = unit === 'lbs' ? ex.weightKg / KG_PER_LB : ex.weightKg
      const wNum = wVal % 1 === 0 ? `${Math.round(wVal)}` : `${Math.round(wVal * 10) / 10}`
      nodes.push(
        <span key={i}>
          {ex.name}
          {'  '}
          <span className="num">{wNum}</span><span className="reveal-unit">{unit}</span>
          {'  '}
          <span className="num">{ex.reps}</span><span className="reveal-unit">reps x </span>
          <span className="num">{ex.sets}</span><span className="reveal-unit">sets</span>
        </span>
      )
    } else {
      nodes.push(<span key={i}>{line}</span>)
    }
  })

  return nodes
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
  bodyweightKg: number,
): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []

  lines.forEach((line, i) => {
    if (i > 0) nodes.push('\n')
    const parsed = parseLine(line, bodyweightKg)
    const unknown = parsed.exercise
      ? !isKnownName(parsed.exercise.name, knownPast, todayCounts)
      : false
    nodes.push(<span key={`l${i}`}>{renderLine(line, parsed, unknown)}</span>)

    // Regular (non-preset) ghost: inline suffix on same line
    if (suggestion?.lineIndex === i && !suggestion.presetLines && !suggestion.nameSuffix) {
      nodes.push(
        <span key={`g${i}`} className="ghost">
          {suggestion.suffix}
          <CornerDownLeft size={12} strokeWidth={2} className="ghost-enter-icon" />
        </span>
      )
    }
    // Case B preset: show name completion inline (exercises shown in block below)
    if (suggestion?.lineIndex === i && suggestion.nameSuffix) {
      nodes.push(
        <span key={`gn${i}`} className="ghost">{suggestion.nameSuffix}</span>
      )
    }
  })

  return nodes
}

export function Editor({
  value, onChange, onCursorChange, onTabConfirm,
  suggestion, knownPast, todayCounts, previousExercises,
  bodyweightKg = 60, bwIsSet = true,
  reveal, readOnly, textareaRef, weightUnit = 'kg',
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Auto-resize textarea to content
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }, [value, textareaRef])

  // Compute right-side badges per line
  const lineTrends: { lineIndex: number; node: React.ReactNode }[] = []
  const lineNewItems: number[] = []
  let bwHintLine = -1  // first line using a bw expression when bw is not set

  value.split('\n').forEach((line, i) => {
    const parsed = parseLine(line, bodyweightKg)
    if (!parsed.exercise) return
    const norm = normalizeName(parsed.exercise.name)
    const prev = previousExercises.get(norm)
    const isNew = !isKnownName(parsed.exercise.name, knownPast, todayCounts)

    if (prev) {
      const node = buildTrend(parsed.exercise, prev, weightUnit)
      if (node) lineTrends.push({ lineIndex: i, node })
    } else if (isNew) {
      lineNewItems.push(i)
    }

    // Track first line using bw expression for the "set bodyweight" hint
    if (!bwIsSet && parsed.exercise.bwExpr && bwHintLine < 0) {
      bwHintLine = i
    }
  })

  const reportCursor = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    onCursorChange(e.currentTarget.selectionStart)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      if (suggestion && !suggestion.isHint) onTabConfirm()
    }
    if (e.key === 'Enter' && suggestion && !suggestion.isHint) {
      e.preventDefault()
      onTabConfirm()
    }
  }

  return (
    <div className="editor-wrap">
      <div
        ref={overlayRef}
        className="editor-overlay"
        aria-hidden="true"
        style={{ opacity: reveal ? 0 : 1, transition: 'opacity 0.15s ease' }}
      >
        {renderOverlay(value, suggestion, knownPast, todayCounts, bodyweightKg)}
        {value.endsWith('\n') || value === '' ? '​' : ''}
      </div>

      {/* Reveal overlay: crossfades in on hold, shows formatted values in orange */}
      <div
        className="editor-overlay"
        aria-hidden="true"
        style={{ opacity: reveal ? 1 : 0, transition: 'opacity 0.15s ease' }}
      >
        {renderRevealOverlay(value, bodyweightKg, weightUnit)}
        {value.endsWith('\n') || value === '' ? '​' : ''}
      </div>

      {/* Trend badges: floated to the right edge, one per exercise line */}
      {!reveal && lineTrends.map(({ lineIndex, node }) => (
        <div
          key={lineIndex}
          className="trend-abs"
          aria-hidden="true"
          style={{ top: `calc(${lineIndex} * var(--editor-lh) * 1em)` }}
        >
          <span className="trend">{node}</span>
        </div>
      ))}

      {/* New-exercise label: right-aligned, fades in like trend badges */}
      {!reveal && lineNewItems.map(lineIndex => (
        <div
          key={`new-${lineIndex}`}
          className="new-exercise-badge"
          aria-hidden="true"
          style={{ top: `calc(${lineIndex} * var(--editor-lh) * 1em)` }}
        >
          <span className="new-label">New exercise!</span>
        </div>
      ))}

      {/* Bodyweight hint: shown on the first bw-expression line when bw not set */}
      {!reveal && bwHintLine >= 0 && (
        <div
          className="new-exercise-badge"
          aria-hidden="true"
          style={{ top: `calc(${bwHintLine} * var(--editor-lh) * 1em)` }}
        >
          <span className="new-label bw-hint-label">type 'bodyweight 75' to set</span>
        </div>
      )}

      {/* Preset ghost block: positioned below the note line, outside normal text flow */}
      {!reveal && suggestion?.presetLines && (
        <div
          className="ghost ghost-preset-block"
          aria-hidden="true"
          style={{ top: `calc(${suggestion.lineIndex + 1} * var(--editor-lh) * 1em)` }}
        >
          {suggestion.presetLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {!suggestion.isHint && (
            <div className="ghost-preset-hint">
              <CornerDownLeft size={11} strokeWidth={2} style={{ verticalAlign: 'middle' }} />
              {' '}enter to fill all
            </div>
          )}
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
