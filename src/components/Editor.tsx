import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeftRight, CornerDownLeft, GripVertical, Trash2 } from 'lucide-react'
import { parseLine, isKnownName, normalizeName, bwExtraLoadKg, type ParsedLine, type Exercise, type ValueField } from '../utils/parser'
import { stepLine } from '../utils/adjust'
import { type WeightUnit, formatWeightDiff } from '../utils/settings'
import { TrendItem } from './TrendItem'
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
  reveal?: boolean        // the formatted view — read-only, its numbers dragged to change
  readOnly?: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  weightUnit?: WeightUnit
  showDownTrend?: boolean
  onSwapLine?: (line: number) => void   // the caret line's swap icon was tapped
  swapLine?: number | null              // line being swapped — held shaded meanwhile
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

const KG_PER_LB = 0.453592

function weightNumber(ex: Exercise, unit: WeightUnit): string {
  const v = unit === 'lbs' ? ex.weightKg / KG_PER_LB : ex.weightKg
  return v % 1 === 0 ? `${Math.round(v)}` : `${Math.round(v * 10) / 10}`
}

/** What the bubble over a value being dragged reads. */
function adjustLabel(line: string, field: ValueField, bodyweightKg: number, unit: WeightUnit): string {
  const ex = parseLine(line, bodyweightKg).exercise
  if (!ex) return ''
  if (field === 'reps') return `${ex.reps} rep${ex.reps === 1 ? '' : 's'}`
  if (field === 'sets') return `${ex.sets} set${ex.sets === 1 ? '' : 's'}`
  const bw = ex.bodyweight ? ex.bwExpr : undefined
  if (bw?.op === 'plain') return 'bodyweight'
  if (bw?.op === 'mul') return `bw × ${bw.factor}`
  if (bw?.op === 'add') return `bw ${bw.offset > 0 ? '+' : '−'} ${Math.abs(bw.offset)}${unit}`
  return `${weightNumber(ex, unit)} ${unit}`
}

// Reveal overlay: exercise lines show formatted values (all orange), non-exercise lines render normally.
// It crossfades over the normal one while the eye is on. Each value the line
// actually writes is tagged with its line and field, so it can be dragged;
// each line carries data-rline, so it can be measured for its grip and icons.
function renderRevealLine(
  line: string, i: number, bodyweightKg: number, unit: WeightUnit,
  active: { line: number; field: ValueField } | null, lifted = false,
): React.ReactNode {
  const parsed = parseLine(line, bodyweightKg)
  const props = { 'data-rline': i, className: lifted ? 'line-lifted' : undefined }
  if (parsed.bodyweightEntry !== undefined) {
    // Show bodyweight entry lines as-is with the number orange
    return (
      <span key={i} {...props}>
        {line.slice(0, parsed.highlights[0]?.start ?? line.length)}
        <span className="num">{line.slice(parsed.highlights[0]?.start, parsed.highlights[0]?.end)}</span>
        {line.slice(parsed.highlights[0]?.end ?? line.length)}
      </span>
    )
  }
  if (!parsed.exercise) return <span key={i} {...props}>{line}</span>
  const ex = parsed.exercise
  // Separate the numeric value from its unit label so the label
  // gets reveal-unit styling (dimmed) matching "reps x" and "sets". The
  // number and its unit are one handle, so either can be grabbed.
  const value = (field: ValueField, n: React.ReactNode, label: string) => {
    const content = <><span className="num">{n}</span><span className="reveal-unit">{label}</span></>
    if (parsed.values?.[field] === undefined) return content
    const on = active?.line === i && active.field === field
    return (
      <span className={`reveal-value${on ? ' adjusting' : ''}`} data-line={i} data-field={field}>
        {content}
      </span>
    )
  }
  return (
    <span key={i} {...props}>
      {ex.name}
      {'  '}
      {value('weight', weightNumber(ex, unit), unit)}
      {'  '}
      {value('reps', ex.reps, 'reps')}<span className="reveal-unit"> x </span>
      {value('sets', ex.sets, 'sets')}
    </span>
  )
}

function renderRevealOverlay(
  text: string, bodyweightKg: number, unit: WeightUnit,
  active: { line: number; field: ValueField } | null,
  lifted: { start: number; count: number } | null,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  text.split('\n').forEach((line, i) => {
    if (i > 0) nodes.push('\n')
    const isLifted = lifted !== null && i >= lifted.start && i < lifted.start + lifted.count
    nodes.push(renderRevealLine(line, i, bodyweightKg, unit, active, isLifted))
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

/** Px box of every logical line, relative to the editor. The note's overlay
 *  tags its lines data-line, the eye's data-rline. */
function measureLines(overlay: HTMLElement, selector = '[data-line]'): LineBox[] {
  const cs = getComputedStyle(overlay)
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.65
  const base = overlay.getBoundingClientRect().top
  const boxes: LineBox[] = []
  let next = 0
  overlay.querySelectorAll<HTMLElement>(selector).forEach(span => {
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

/** Travel before a press on a revealed value starts adjusting it. */
const ADJUST_SLOP = 4
/** Finger travel per step while adjusting. */
const STEP_PX = 42
/** Pace of the value catching up when the finger outruns it — one step at a time, never a skip. */
const CATCH_UP_MS = 30
/** How long the trash stays armed after its first tap. */
const TRASH_ARM_MS = 4000

interface Press {
  line: number
  field: ValueField
  pointerId: number
  x: number
  y: number
  el: HTMLElement
}

interface Adjust {
  line: number
  field: ValueField
  at: { left: number; top: number }  // the value's top centre, editor-relative
}

/** The steps behind an adjust: where the value is, and where the finger is. */
interface Stepping {
  line: number
  field: ValueField
  base: string      // the line as it was when the drag began
  cur: number       // steps applied so far
  target: number    // steps the finger has travelled
}

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
  const [adjust, setAdjust] = useState<Adjust | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const press = useRef<Press | null>(null)
  const valueRef = useRef(value)
  valueRef.current = value
  const revealRef = useRef(reveal)
  revealRef.current = reveal
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const revealOverlayRef = useRef<HTMLDivElement>(null)
  const stepping = useRef<Stepping | null>(null)
  const catchUp = useRef(0)
  // Every line's box in the eye's view, for its grip and icons.
  const [rowBoxes, setRowBoxes] = useState<LineBox[]>([])
  const [armedTrash, setArmedTrash] = useState<number | null>(null)
  const rowControls = reveal && !readOnly

  const lines = value.split('\n')
  // The grip sits on the hovered line (mouse), else the caret's line while the
  // note has focus — so it only shows up once you're working in the note.
  const caretLine = value.slice(0, caret).split('\n').length - 1
  const gripLine = drag ? drag.start
    : readOnly || reveal ? null
    : hoverLine ?? (focused ? caretLine : null)
  // In the eye's view every line has its own grip instead.
  const showGrip = !reveal && gripLine !== null && gripLine < lines.length &&
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
    const el = reveal ? revealOverlayRef.current : overlayRef.current
    if (swapLine === null || !el) { setMarkBox(null); return }
    setMarkBox(measureLines(el, reveal ? '[data-rline]' : '[data-line]')[swapLine] ?? null)
  }, [swapLine, value, layoutTick, reveal])

  // The eye's view lays the note out afresh, so its rows are measured off it.
  useLayoutEffect(() => {
    if (!rowControls || drag || !revealOverlayRef.current) return
    setRowBoxes(measureLines(revealOverlayRef.current, '[data-rline]'))
  }, [rowControls, drag, value, layoutTick, weightUnit, bodyweightKg])

  // An armed trash disarms on its own, and whenever the note changes under it.
  useEffect(() => {
    if (armedTrash === null) return
    const t = setTimeout(() => setArmedTrash(null), TRASH_ARM_MS)
    return () => clearTimeout(t)
  }, [armedTrash])
  useEffect(() => { setArmedTrash(null) }, [value, reveal])

  // The swap icon rides at the end of the caret's line whenever that line is an
  // exercise — no tap to summon it. It steps aside for an inline suggestion,
  // which would be sitting in the same spot.
  const showSwap = onSwapLine !== undefined && focused && !reveal && !readOnly && !drag?.active &&
    suggestion?.lineIndex !== caretLine &&
    parseLine(lines[caretLine] ?? '', bodyweightKg).exercise !== null

  useLayoutEffect(() => {
    if (!showSwap || !overlayRef.current) { setSwapAt(null); return }
    setSwapAt(lineEnd(overlayRef.current, caretLine))
  }, [showSwap, caretLine, value, layoutTick])

  // `line` is given by the eye's grips, one per line; the note's single grip
  // leaves it out and picks up whatever line is under the press.
  const handleGripDown = (e: React.PointerEvent<HTMLDivElement>, line?: number) => {
    if (line === undefined && (gripLine === null || !overlayRef.current)) return
    if (line !== undefined && !revealOverlayRef.current) return
    e.preventDefault()   // keep the textarea's focus, and its keyboard, up
    e.currentTarget.setPointerCapture(e.pointerId)
    let start: number
    let boxes: LineBox[]
    if (line !== undefined) {
      boxes = measureLines(revealOverlayRef.current!, '[data-rline]')
      start = line
    } else {
      // Pick up the line actually under the press, not the one state last
      // pointed the grip at — the two can differ while the grip slides over.
      boxes = measureLines(overlayRef.current!)
      const y = e.clientY - overlayRef.current!.getBoundingClientRect().top
      const pressed = boxes.findIndex(b => y >= b.top && y < b.top + b.height)
      start = pressed >= 0 ? pressed : gripLine!
    }
    setDrag({
      ...blockRange(lines, start),
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

  // ── Adjusting a revealed value ──
  // A touch that starts on a value is the value's from start to finish: the
  // day swipe never sees any of it, so a drag that wanders sideways can't
  // turn the page. A touch's events all target the element it started on,
  // so its start decides. React's touch listeners are passive and can't stop
  // the scroll, so these go on by hand.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onValue = (e: TouchEvent) =>
      revealRef.current && (e.target as Element | null)?.closest?.('.reveal-value') != null
    const keep = (e: TouchEvent) => { if (onValue(e)) e.stopPropagation() }
    const keepMove = (e: TouchEvent) => { if (onValue(e)) { e.preventDefault(); e.stopPropagation() } }
    el.addEventListener('touchstart', keep)
    el.addEventListener('touchmove', keepMove, { passive: false })
    el.addEventListener('touchend', keep)
    el.addEventListener('touchcancel', keep)
    return () => {
      el.removeEventListener('touchstart', keep)
      el.removeEventListener('touchmove', keepMove)
      el.removeEventListener('touchend', keep)
      el.removeEventListener('touchcancel', keep)
    }
  }, [])

  // The value walks toward the finger one step at a time, so a quick drag
  // still shows every value on the way instead of jumping past them.
  const stepOnce = () => {
    catchUp.current = 0
    const s = stepping.current
    if (!s || s.cur === s.target) return
    s.cur += Math.sign(s.target - s.cur)
    // Stepped from the line as it was at the start, so a step that can't move
    // (a rep count at 1) holds still rather than drifting.
    const next = stepLine(s.base, s.field, s.cur)
    const out = valueRef.current.split('\n')
    if (out[s.line] !== next) {
      navigator.vibrate?.(4)
      out[s.line] = next
      valueRef.current = out.join('\n')
      onChangeRef.current(valueRef.current)
    }
    if (s.cur !== s.target) catchUp.current = window.setTimeout(stepOnce, CATCH_UP_MS)
  }

  // Letting go lands on wherever the finger got to.
  const finishStepping = () => {
    clearTimeout(catchUp.current)
    catchUp.current = 0
    const s = stepping.current
    stepping.current = null
    if (!s || s.cur === s.target) return
    const out = valueRef.current.split('\n')
    out[s.line] = stepLine(s.base, s.field, s.target)
    valueRef.current = out.join('\n')
    onChangeRef.current(valueRef.current)
  }

  useEffect(() => () => clearTimeout(catchUp.current), [])

  // Turning the eye off mid-press drops it.
  useEffect(() => {
    if (reveal) return
    press.current = null
    finishStepping()
    setAdjust(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal])

  const endPress = () => { press.current = null }

  // In the eye's view the values are handles: no hold, a press that moves
  // adjusts straight away, by its vertical travel. The pointer is caught on
  // the press, so a quick drag that outruns the number still reaches it.
  const handleValueDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (readOnly || e.button !== 0 || press.current) return
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-field]')
    if (!el) return
    try { el.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    press.current = {
      line: Number(el.dataset.line),
      field: el.dataset.field as ValueField,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      el,
    }
  }

  const handleValueMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p || e.pointerId !== p.pointerId) return
    if (!stepping.current) {
      const dx = e.clientX - p.x
      const dy = e.clientY - p.y
      if (Math.hypot(dx, dy) < ADJUST_SLOP || !wrapRef.current) return
      navigator.vibrate?.(8)
      const r = p.el.getBoundingClientRect()
      const base = wrapRef.current.getBoundingClientRect()
      stepping.current = {
        line: p.line,
        field: p.field,
        base: valueRef.current.split('\n')[p.line] ?? '',
        cur: 0,
        target: 0,
      }
      setAdjust({
        line: p.line,
        field: p.field,
        at: { left: r.left + r.width / 2 - base.left, top: r.top - base.top },
      })
      return
    }
    const s = stepping.current
    if (!s) return
    // Whole steps only: each one takes the full distance, the first included.
    s.target = Math.trunc((p.y - e.clientY) / STEP_PX)
    if (!catchUp.current) stepOnce()
  }

  const handleValueUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p || e.pointerId !== p.pointerId) return
    endPress()
    finishStepping()
    setAdjust(null)
  }

  const removeLine = (i: number) => {
    setArmedTrash(null)
    onChange(lines.filter((_, k) => k !== i).join('\n'))
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
    if (readOnly) return
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
      ref={wrapRef}
      className={`editor-wrap${reveal ? ' revealed' : ''}${readOnly ? ' read-only' : ''}`}
      onPointerMove={handleWrapPointerMove}
      onPointerLeave={() => setHoverLine(null)}
    >
      {markBox && (
        <div className="line-mark" aria-hidden="true" style={{ top: markBox.top, height: markBox.height }} />
      )}

      <div
        ref={overlayRef}
        className="editor-overlay"
        aria-hidden="true"
        style={{ opacity: reveal ? 0 : 1, transition: 'opacity 0.15s ease' }}
      >
        {renderOverlay(value, dragging ? null : suggestion, knownPast, todayCounts, bodyweightKg, dragging ? drag : null)}
        {value.endsWith('\n') || value === '' ? '​' : ''}
      </div>

      {/* Reveal overlay: crossfades in while the eye is on, shows formatted
          values in orange. Hold one and drag up or down to change it. */}
      <div
        className="editor-overlay reveal-overlay"
        aria-hidden="true"
        style={{ opacity: reveal ? 1 : 0, transition: 'opacity 0.15s ease' }}
        onPointerDown={reveal ? handleValueDown : undefined}
        onPointerMove={reveal ? handleValueMove : undefined}
        onPointerUp={reveal ? handleValueUp : undefined}
        onPointerCancel={reveal ? () => { endPress(); finishStepping(); setAdjust(null) } : undefined}
        onContextMenu={reveal ? e => e.preventDefault() : undefined}
        ref={revealOverlayRef}
      >
        {renderRevealOverlay(value, bodyweightKg, weightUnit, adjust, reveal && dragging ? drag : null)}
        {value.endsWith('\n') || value === '' ? '​' : ''}
      </div>

      {adjust && (
        <div className="adjust-bubble" aria-hidden="true" style={{ left: adjust.at.left, top: adjust.at.top }}>
          {adjustLabel(lines[adjust.line] ?? '', adjust.field, bodyweightKg, weightUnit)}
        </div>
      )}

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
        <div className={`line-ghost${reveal ? ' reveal' : ''}`} aria-hidden="true" style={{ top: ghost.top, height: ghost.height }}>
          {lines.slice(drag.start, drag.start + drag.count).map((line, i) => (
            <div key={i}>
              {reveal
                ? renderRevealLine(line, drag.start + i, bodyweightKg, weightUnit, null)
                : renderLine(line, parseLine(line, bodyweightKg), false)}
            </div>
          ))}
        </div>
      )}

      {/* The eye's row controls, always up: a grip before every line to move
          it, and for each exercise a swap and a trash on the right edge. */}
      {rowControls && lines.map((line, i) => {
        const box = rowBoxes[i]
        if (!box || line.trim() === '') return null
        const held = drag?.start === i
        // The grip stays mounted through its own drag — it holds the capture.
        if (dragging && !held) return null
        return (
          <div
            key={`grip${i}`}
            className={`line-grip${held && drag?.active ? ' dragging' : ''}`}
            style={{ top: held && ghost ? ghost.top : box.top }}
            onPointerDown={e => handleGripDown(e, i)}
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
        )
      })}

      {rowControls && !dragging && lines.map((line, i) => {
        const box = rowBoxes[i]
        if (!box || !parseLine(line, bodyweightKg).exercise) return null
        const armed = armedTrash === i
        return (
          <div key={`act${i}`} className="row-actions" style={{ top: box.top }}>
            {onSwapLine && (
              <button
                type="button"
                className="row-action"
                onPointerDown={tap}
                onTouchStart={e => e.stopPropagation()}
                onClick={() => onSwapLine(i)}
                aria-label="Swap exercise"
              >
                <ArrowLeftRight size={15} strokeWidth={2.25} />
              </button>
            )}
            {/* Two taps: the first arms it, red; the second removes the line. */}
            <button
              type="button"
              className={`row-action trash${armed ? ' armed' : ''}`}
              onPointerDown={tap}
              onTouchStart={e => e.stopPropagation()}
              onClick={() => (armed ? removeLine(i) : setArmedTrash(i))}
              aria-label={armed ? 'Tap again to remove' : 'Remove exercise'}
            >
              <Trash2 size={15} strokeWidth={2.25} />
            </button>
          </div>
        )
      })}

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
        readOnly={readOnly || reveal}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        placeholder=""
      />
    </div>
  )
}
