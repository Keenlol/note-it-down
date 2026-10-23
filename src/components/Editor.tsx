import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeftRight, CornerDownLeft, GripVertical } from 'lucide-react'
import { parseLine, isKnownName, normalizeName, type ParsedLine, type Exercise } from '../utils/parser'
import { buildTrend } from '../utils/trend'
import { blockRange, moveLines, pickSlot, slotY, maxDropSlot, type LineBox } from '../utils/lines'
import { type WeightUnit } from '../utils/settings'
import { tap } from '../utils/tap'

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
  readOnly?: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  weightUnit?: WeightUnit
  showDownTrend?: boolean
  onSwapLine?: (line: number) => void   // the caret line's swap icon was tapped
  swapLine?: number | null              // line being swapped — held shaded meanwhile
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

/** Where a line's text ends: just past its last glyph, on its last row. */
function lineEnd(overlay: HTMLElement, line: number): { left: number; top: number } | null {
  const rects = overlay.querySelector(`[data-line="${line}"]`)?.getClientRects()
  if (!rects || rects.length === 0) return null
  const last = rects[rects.length - 1]
  const cs = getComputedStyle(overlay)
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.65
  const base = overlay.getBoundingClientRect()
  return {
    left: last.right - base.left,
    top: Math.round(last.top - base.top - (lh - last.height) / 2),
  }
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
  readOnly, textareaRef, weightUnit = 'kg', showDownTrend = true,
  onSwapLine, swapLine = null,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)
  const [caret, setCaret] = useState(0)
  const [hoverLine, setHoverLine] = useState<number | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [gripBox, setGripBox] = useState<LineBox | null>(null)
  const [layoutTick, setLayoutTick] = useState(0)
  const [markBox, setMarkBox] = useState<LineBox | null>(null)
  const [swapAt, setSwapAt] = useState<{ left: number; top: number } | null>(null)

  const lines = value.split('\n')
  // The grip sits on the hovered line (mouse), else the caret's line while the
  // note has focus — so it only shows up once you're working in the note.
  const caretLine = value.slice(0, caret).split('\n').length - 1
  const gripLine = drag ? drag.start
    : readOnly ? null
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

  // The line being swapped stays shaded while the picker is up.
  useLayoutEffect(() => {
    if (swapLine === null || !overlayRef.current) { setMarkBox(null); return }
    setMarkBox(measureLines(overlayRef.current)[swapLine] ?? null)
  }, [swapLine, value, layoutTick])

  // The swap icon rides at the end of the caret's line whenever that line is an
  // exercise — no tap to summon it. It steps aside for an inline suggestion,
  // which would be sitting in the same spot.
  const showSwap = onSwapLine !== undefined && focused && !readOnly && !drag?.active &&
    suggestion?.lineIndex !== caretLine &&
    parseLine(lines[caretLine] ?? '', bodyweightKg).exercise !== null

  useLayoutEffect(() => {
    if (!showSwap || !overlayRef.current) { setSwapAt(null); return }
    setSwapAt(lineEnd(overlayRef.current, caretLine))
  }, [showSwap, caretLine, value, layoutTick])

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
    setDrag({ ...drag, active: true, dy, slot: pickSlot(drag.boxes, drag.start, drag.count, dy, maxDropSlot(lines)) })
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
      {markBox && (
        <div className="line-mark" aria-hidden="true" style={{ top: markBox.top, height: markBox.height }} />
      )}

      <div ref={overlayRef} className="editor-overlay" aria-hidden="true">
        {renderOverlay(value, dragging ? null : suggestion, knownPast, todayCounts, bodyweightKg, dragging ? drag : null)}
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

      {/* New-exercise label: right-aligned, fades in like trend badges */}
      {lineNewItems.map(lineIndex => (
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
      {bwHintLine >= 0 && (
        <div
          className="new-exercise-badge"
          aria-hidden="true"
          style={{ top: `calc(${bwHintLine} * var(--editor-lh) * 1em)` }}
        >
          <span className="new-label bw-hint-label">type 'bodyweight 75' to set</span>
        </div>
      )}

      {/* Preset ghost block: positioned below the note line, outside normal text flow */}
      {!dragging && suggestion?.presetLines && (
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

      {showSwap && swapAt && (
        <button
          type="button"
          className="line-swap"
          style={{ left: `min(${swapAt.left + 2}px, 100% - 30px)`, top: swapAt.top }}
          onPointerDown={e => { e.preventDefault(); tap(e) }}
          onTouchStart={e => e.stopPropagation()}
          onClick={() => onSwapLine(caretLine)}
          aria-label="Swap exercise"
        >
          <ArrowLeftRight size={15} strokeWidth={2.25} />
        </button>
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
