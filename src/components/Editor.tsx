import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CornerDownLeft, GripVertical } from 'lucide-react'
import { parseLine, isKnownName, normalizeName, bwExtraLoadKg, type ParsedLine, type Exercise } from '../utils/parser'
import { type WeightUnit, formatWeightDiff } from '../utils/settings'
import { TrendItem } from './TrendItem'

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
  showDownTrend?: boolean
}

function buildTrend(current: Exercise, prev: Exercise, unit: WeightUnit, showDown: boolean): React.ReactNode | null {
  const setsDiff = current.sets - prev.sets
  const repsDiff = current.reps - prev.reps

  // Compare load above bodyweight, not absolute weight: this suppresses raw
  // bodyweight drift between days (plain bw → plain bw stays flat) while still
  // catching genuine added load (bw → bw+6 reads as +6kg).
  // Threshold is 0.05 (half the 0.1kg display precision) so decimal/microplate
  // changes still register, and a true 0.5kg jump isn't dropped by float error.
  const curLoad = current.bodyweight ? bwExtraLoadKg(current) : current.weightKg
  const prevLoad = prev.bodyweight ? bwExtraLoadKg(prev) : prev.weightKg
  const rawWeight = curLoad - prevLoad
  const weightDiff = Math.abs(rawWeight) >= 0.05 ? rawWeight : 0

  const parts: { key: string; diff: number; label: React.ReactNode }[] = [
    { key: 's', diff: setsDiff, label: `${Math.abs(setsDiff)} set${Math.abs(setsDiff) !== 1 ? 's' : ''}` },
    { key: 'r', diff: repsDiff, label: `${Math.abs(repsDiff)} rep${Math.abs(repsDiff) !== 1 ? 's' : ''}` },
    { key: 'w', diff: weightDiff, label: formatWeightDiff(Math.abs(weightDiff), unit) },
  ].filter(p => p.diff !== 0 && (p.diff > 0 || showDown))

  if (parts.length === 0) return null
  return <>{parts.map(p => (
    <TrendItem key={p.key} diff={p.diff} size={13}>{p.label}</TrendItem>
  ))}</>
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
  lifted: { start: number; count: number } | null,
): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []

  lines.forEach((line, i) => {
    if (i > 0) nodes.push('\n')
    const parsed = parseLine(line, bodyweightKg)
    const unknown = parsed.exercise
      ? !isKnownName(parsed.exercise.name, knownPast, todayCounts)
      : false
    const isLifted = lifted !== null && i >= lifted.start && i < lifted.start + lifted.count
    nodes.push(
      <span key={`l${i}`} data-line={i} className={isLifted ? 'line-lifted' : undefined}>
        {renderLine(line, parsed, unknown)}
      </span>
    )

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

// ── Line blocks ─────────────────────────────────────────────────────────────
// The note stays one textarea; "blocks" are a layer over it. Each logical line
// is measured off its overlay span, so a line that wraps is still one block.

interface LineBox { top: number; height: number }

/** Px box of every logical line, relative to the editor. */
function measureLines(overlay: HTMLElement): LineBox[] {
  const cs = getComputedStyle(overlay)
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.65
  const base = overlay.getBoundingClientRect().top
  const boxes: LineBox[] = []
  let next = 0
  overlay.querySelectorAll<HTMLElement>('[data-line]').forEach(span => {
    const rects = [...span.getClientRects()]
    let top = next
    let rows = 1
    if (rects.length > 0) {
      // A rect covers the glyphs only; half the leading sits above them.
      top = Math.round(rects[0].top - base - (lh - rects[0].height) / 2)
      rows = new Set(rects.map(r => Math.round(r.top))).size
    }
    boxes.push({ top, height: rows * lh })
    next = top + rows * lh
  })
  return boxes
}

function isHeaderLine(line: string): boolean {
  if (!line.trim().startsWith('#')) return false
  const p = parseLine(line)
  return p.exercise === null && p.bodyweightEntry === undefined
}

/**
 * Lines that move together when `line` is dragged: just itself, or for a "#"
 * header its whole preset — up to the next header, minus trailing blank lines,
 * which stay behind as the gap between blocks.
 */
function blockRange(lines: string[], line: number): { start: number; count: number } {
  if (!isHeaderLine(lines[line])) return { start: line, count: 1 }
  let end = line + 1
  while (end < lines.length && !isHeaderLine(lines[end])) end++
  while (end > line + 1 && lines[end - 1].trim() === '') end--
  return { start: line, count: end - line }
}

const isBlank = (line: string | undefined) => line !== undefined && line.trim() === ''

/**
 * Move `count` lines from `start` to before line `slot` (indices before the
 * move); returns the new lines and where the block's first line landed.
 *
 * A preset block that sat apart from its neighbours with blank lines keeps
 * that spacing: the hole it leaves closes up to a single gap, and it is set
 * apart again wherever it lands. Single lines just move.
 */
function moveLines(
  lines: string[], start: number, count: number, slot: number,
): { lines: string[]; landed: number } {
  const out = [...lines]
  const moved = out.splice(start, count)
  let at = slot > start ? slot - count : slot

  const spaced = isHeaderLine(moved[0]) && (isBlank(lines[start - 1]) || isBlank(lines[start + count]))
  if (spaced) {
    // Close the hole: two gaps meeting where the block was, or one left on top.
    if (start === 0 ? isBlank(out[0]) : isBlank(out[start - 1]) && isBlank(out[start])) {
      out.splice(start, 1)
      if (at > start) at--
    }
    if (at > 0 && !isBlank(out[at - 1])) { out.splice(at, 0, ''); at++ }
    if (at < out.length && !isBlank(out[at])) out.splice(at, 0, '')
  }

  out.splice(at, 0, ...moved)
  return { lines: out, landed: at }
}

function slotY(boxes: LineBox[], slot: number): number {
  if (slot < boxes.length) return boxes[slot].top
  const last = boxes[boxes.length - 1]
  return last.top + last.height
}

/**
 * Gap the dragged block would land in. Moving up, its top edge picks the gap;
 * moving down, its bottom edge — so a block swaps with its neighbour once it is
 * halfway past it. Null while that gap is the block's own place. Nothing lands
 * past `maxSlot`, which keeps a trailing newline the last thing in the note.
 */
function pickSlot(
  boxes: LineBox[], start: number, count: number, dy: number, maxSlot: number,
): number | null {
  const first = boxes[start]
  const last = boxes[start + count - 1]
  const edge = dy < 0 ? first.top + dy : last.top + last.height + dy
  let best = 0
  let bestDist = Infinity
  for (let k = 0; k <= maxSlot; k++) {
    const d = Math.abs(slotY(boxes, k) - edge)
    if (d < bestDist) { best = k; bestDist = d }
  }
  return best >= start && best <= start + count ? null : best
}

/** Below this, a press on the grip is a tap, not a drag. */
const DRAG_SLOP = 4

interface DragState {
  start: number
  count: number
  pointerId: number
  originY: number      // pointer Y at press, editor-relative
  boxes: LineBox[]     // line boxes measured at press
  active: boolean      // past DRAG_SLOP
  dy: number           // pointer travel since press
  slot: number | null  // insertion slot, null while over the block's own place
}

export function Editor({
  value, onChange, onCursorChange, onTabConfirm,
  suggestion, knownPast, todayCounts, previousExercises,
  bodyweightKg = 60, bwIsSet = true,
  reveal, readOnly, textareaRef, weightUnit = 'kg', showDownTrend = true,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState(0)
  const [hoverLine, setHoverLine] = useState<number | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [gripBox, setGripBox] = useState<LineBox | null>(null)
  const [layoutTick, setLayoutTick] = useState(0)

  const lines = value.split('\n')
  // The grip sits on the hovered line (mouse), else the caret's line while the
  // note has focus — so it only shows up once you're working in the note.
  const caretLine = value.slice(0, caret).split('\n').length - 1
  const gripLine = drag ? drag.start
    : readOnly || reveal ? null
    : hoverLine ?? (focused ? caretLine : null)
  const showGrip = gripLine !== null && gripLine < lines.length &&
    (drag !== null || lines[gripLine].trim() !== '')

  useEffect(() => {
    const bump = () => setLayoutTick(t => t + 1)
    window.addEventListener('resize', bump)
    return () => window.removeEventListener('resize', bump)
  }, [])

  // Re-measured after every edit, since a line above can wrap or unwrap. Held
  // still during a drag: the grip rides with the lifted block instead.
  useLayoutEffect(() => {
    if (drag || !showGrip || gripLine === null || !overlayRef.current) return
    setGripBox(measureLines(overlayRef.current)[gripLine] ?? null)
  }, [drag, showGrip, gripLine, value, layoutTick])

  const handleGripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gripLine === null || !overlayRef.current) return
    e.preventDefault()   // keep the textarea's focus, and its keyboard, up
    e.currentTarget.setPointerCapture(e.pointerId)
    // Pick up the line actually under the press, not the one state last
    // pointed the grip at — the two can differ while the grip slides over.
    const boxes = measureLines(overlayRef.current)
    const y = e.clientY - overlayRef.current.getBoundingClientRect().top
    const pressed = boxes.findIndex(b => y >= b.top && y < b.top + b.height)
    setDrag({
      ...blockRange(lines, pressed >= 0 ? pressed : gripLine),
      pointerId: e.pointerId,
      originY: e.clientY,
      boxes,
      active: false,
      dy: 0,
      slot: null,
    })
  }

  const handleGripMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const dy = e.clientY - drag.originY
    if (!drag.active && Math.abs(dy) < DRAG_SLOP) return
    if (!drag.active) navigator.vibrate?.(8)
    // The empty line after a trailing newline stays last.
    const maxSlot = lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
    setDrag({ ...drag, active: true, dy, slot: pickSlot(drag.boxes, drag.start, drag.count, dy, maxSlot) })
  }

  const handleGripUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    setDrag(null)
    if (!drag.active || drag.slot === null) return

    const { lines: next, landed } = moveLines(lines, drag.start, drag.count, drag.slot)
    // Caret to the end of the moved line, so the grip follows it there.
    const pos = next.slice(0, landed).reduce((n, l) => n + l.length + 1, 0) + next[landed].length
    onChange(next.join('\n'))
    setCaret(pos)
    onCursorChange(pos)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (ta && document.activeElement === ta) ta.setSelectionRange(pos, pos)
    })
  }

  const handleWrapPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || drag || !overlayRef.current) return
    const y = e.clientY - overlayRef.current.getBoundingClientRect().top
    const i = measureLines(overlayRef.current).findIndex(b => y >= b.top && y < b.top + b.height)
    setHoverLine(i >= 0 ? i : null)
  }

  // The lifted block, and the gap it would drop into. Suggestions step aside
  // meanwhile — a preset ghost floats over the very lines being rearranged.
  const dragging = drag?.active === true
  let ghost: LineBox | null = null
  let dropY: number | null = null
  if (drag?.active) {
    const first = drag.boxes[drag.start]
    const last = drag.boxes[drag.start + drag.count - 1]
    ghost = { top: first.top + drag.dy, height: last.top + last.height - first.top }
    if (drag.slot !== null) dropY = slotY(drag.boxes, drag.slot)
  }

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
      const node = buildTrend(parsed.exercise, prev, weightUnit, showDownTrend)
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
    setCaret(e.currentTarget.selectionStart)
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
    <div
      className="editor-wrap"
      onPointerMove={handleWrapPointerMove}
      onPointerLeave={() => setHoverLine(null)}
    >
      <div
        ref={overlayRef}
        className="editor-overlay"
        aria-hidden="true"
        style={{ opacity: reveal ? 0 : 1, transition: 'opacity 0.15s ease' }}
      >
        {renderOverlay(value, dragging ? null : suggestion, knownPast, todayCounts, bodyweightKg, dragging ? drag : null)}
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
      {!reveal && !dragging && suggestion?.presetLines && (
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

      {dropY !== null && (
        <div className="line-drop" aria-hidden="true" style={{ top: dropY - 1 }} />
      )}

      {ghost && drag && (
        <div className="line-ghost" aria-hidden="true" style={{ top: ghost.top, height: ghost.height }}>
          {lines.slice(drag.start, drag.start + drag.count).map((line, i) => (
            <div key={i}>{renderLine(line, parseLine(line, bodyweightKg), false)}</div>
          ))}
        </div>
      )}

      {/* Stays mounted through the drag — it holds the pointer capture. Touch
          is stopped here so the day swipe and history pull never see it. */}
      {showGrip && gripBox && (
        <div
          className={`line-grip${drag?.active ? ' dragging' : ''}`}
          style={{ top: ghost ? ghost.top : gripBox.top }}
          onPointerDown={handleGripDown}
          onPointerMove={handleGripMove}
          onPointerUp={handleGripUp}
          onPointerCancel={() => setDrag(null)}
          onMouseDown={e => e.preventDefault()}
          onTouchStart={e => e.stopPropagation()}
          onTouchMove={e => e.stopPropagation()}
          onTouchEnd={e => e.stopPropagation()}
          role="button"
          aria-label="Drag to move line"
        >
          <GripVertical size={16} strokeWidth={2.25} />
        </div>
      )}

      <textarea
        ref={textareaRef}
        className={`editor-textarea${readOnly ? ' read-only' : ''}`}
        value={value}
        onChange={e => {
          onChange(e.target.value)
          setCaret(e.target.selectionStart)
          onCursorChange(e.target.selectionStart)
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
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
