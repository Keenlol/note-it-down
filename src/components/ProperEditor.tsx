import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, ChevronDown, Copy, Plus, Trash2 } from 'lucide-react'
import { parseLine, isKnownName, normalizeName, type Exercise } from '../utils/parser'
import {
  isHeaderLine, isBlank, blockRange, moveLines, pickSlot, slotY, maxDropSlot,
  appendLines, readValues, writeLine, type LineBox, type LineValues,
} from '../utils/lines'
import type { WeightUnit } from '../utils/settings'
import { buildTrend } from '../utils/trend'
import { tap } from '../utils/tap'

type Field = 'weight' | 'reps' | 'sets'
type Kind = 'exercise' | 'header' | 'text' | 'blank'

interface Props {
  value: string
  onChange: (text: string) => void
  onCursorLine: (line: number) => void         // a row was opened — the day nav follows it
  onSwapLine: (line: number) => void           // exercise row → exercise picker
  onPickPreset: () => void                     // the preset selector on top
  onAddExercise: () => void                    // "+" under the exercises
  swapLine: number | null                      // row held marked while a picker is up
  templates: Map<string, string[]>             // preset → its lines from the last time it was done
  aliases: Record<string, string>
  knownPast: Set<string>
  todayCounts: Map<string, number>
  previousExercises: Map<string, Exercise>
  bodyweightKg: number
  weightUnit: WeightUnit
  showDownTrend: boolean
  rootRef: React.RefObject<HTMLDivElement | null>
}

/** How long a press has to rest before it becomes an adjust or a move. */
const HOLD_MS = 260
/** Travel that gives a press away as a scroll or a swipe before the hold lands. */
const HOLD_SLOP = 8
/** Finger travel per step while adjusting a value. */
const STEP_PX = 14
/** How long a removed row offers its undo. */
const UNDO_MS = 5000

const round1 = (n: number) => Math.round(n * 10) / 10
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
/** A step of `k` from `v`, landing on the step grid — so 61.3 steps to 62.5, not 63.8. */
const onGrid = (v: number, k: number, step: number) => round1(Math.round((v + k * step) / step) * step)

function stepValues(v: LineValues, field: Field, k: number): LineValues {
  if (k === 0) return v
  if (field === 'reps') return { ...v, reps: clamp(v.reps + k, 1, 999) }
  if (field === 'sets') return { ...v, sets: clamp(v.sets + k, 1, 99) }
  const step = v.unit === 'lbs' ? 5 : 2.5
  if (v.bw?.op === 'mul') return { ...v, bw: { op: 'mul', factor: Math.max(0.1, round1(v.bw.factor + k * 0.1)) } }
  if (v.bw) return { ...v, bw: { op: 'add', offset: onGrid(v.bw.op === 'add' ? v.bw.offset : 0, k, step) } }
  return { ...v, weight: Math.max(0, onGrid(v.weight, k, step)) }
}

function weightLabel(v: LineValues): { value: string; unit: string } {
  if (!v.bw) return { value: `${round1(v.weight)}`, unit: v.unit }
  switch (v.bw.op) {
    case 'plain': return { value: 'BW', unit: '' }
    case 'mul':   return { value: `BW×${round1(v.bw.factor)}`, unit: '' }
    case 'add':
      if (v.bw.offset === 0) return { value: 'BW', unit: '' }
      return { value: `BW${v.bw.offset > 0 ? '+' : '−'}${round1(Math.abs(v.bw.offset))}`, unit: v.unit }
  }
}

function bubbleLabel(v: LineValues, field: Field): string {
  if (field === 'reps') return `${v.reps} rep${v.reps === 1 ? '' : 's'}`
  if (field === 'sets') return `${v.sets} set${v.sets === 1 ? '' : 's'}`
  const w = weightLabel(v)
  return w.unit ? `${w.value} ${w.unit}` : w.value
}

const headerName = (line: string) => line.trim().replace(/^#+\s*/, '')

function kindOf(line: string): Kind {
  if (isBlank(line)) return 'blank'
  if (parseLine(line).exercise) return 'exercise'
  return isHeaderLine(line) ? 'header' : 'text'
}

interface Press {
  line: number
  field: Field | null   // a value chip → adjust; anywhere else → move
  pointerId: number
  x: number
  y: number
  el: HTMLElement
  timer: number
  held: boolean
}

interface Adjust { line: number; field: Field; base: LineValues; originY: number; steps: number }
interface Drag { start: number; count: number; originY: number; boxes: LineBox[]; dy: number; slot: number | null }
interface Undo { line: number; before: string; after: string; label: string }

/**
 * Proper mode: the same note, one box per line. A day is one preset — its
 * selector sits on top, every exercise below belongs to it. Nothing is typed
 * here: values are held and dragged, rows are held and moved, and exercises
 * and the preset come from pickers. Every change is written straight back into
 * the text, which stays the one source of truth.
 */
export function ProperEditor({
  value, onChange, onCursorLine, onSwapLine, onPickPreset, onAddExercise, swapLine,
  templates, aliases, knownPast, todayCounts, previousExercises,
  bodyweightKg, weightUnit, showDownTrend, rootRef,
}: Props) {
  const lines = value.split('\n')
  const kinds = lines.map(kindOf)
  const [open, setOpen] = useState<number | null>(null)
  const [adjust, setAdjust] = useState<Adjust | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [undo, setUndo] = useState<Undo | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set())
  const press = useRef<Press | null>(null)
  // Once a hold has turned into an adjust or a move, the page must not scroll
  // and the day swipe must not see the touch.
  const holding = useRef(false)
  const valueRef = useRef(value)
  valueRef.current = value

  // Touch listeners have to be non-passive to stop the scroll, which React's
  // aren't — so these two go on by hand.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onMove = (e: TouchEvent) => { if (holding.current) { e.preventDefault(); e.stopPropagation() } }
    const onEnd = (e: TouchEvent) => { if (holding.current) e.stopPropagation() }
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    return () => { el.removeEventListener('touchmove', onMove); el.removeEventListener('touchend', onEnd) }
  }, [rootRef])

  // A tap anywhere else folds the open row back.
  useEffect(() => {
    if (open === null) return
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open, rootRef])

  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), UNDO_MS)
    return () => clearTimeout(t)
  }, [undo])

  useEffect(() => () => clearTimeout(press.current?.timer), [])

  const measure = (): LineBox[] => {
    const root = rootRef.current
    if (!root) return []
    const base = root.getBoundingClientRect().top
    return [...root.querySelectorAll<HTMLElement>(':scope > [data-line]')].map(el => {
      const r = el.getBoundingClientRect()
      return { top: r.top - base, height: r.height }
    })
  }

  const endPress = () => {
    const p = press.current
    if (p) clearTimeout(p.timer)
    press.current = null
    holding.current = false
  }

  const onHold = (p: Press) => {
    if (press.current !== p) return
    p.held = true
    holding.current = true
    try { p.el.setPointerCapture(p.pointerId) } catch { /* pointer already gone */ }
    navigator.vibrate?.(8)
    const current = valueRef.current.split('\n')
    if (p.field) {
      const base = readValues(current[p.line], weightUnit)
      if (base) setAdjust({ line: p.line, field: p.field, base, originY: p.y, steps: 0 })
    } else {
      setOpen(null)
      setDrag({ ...blockRange(current, p.line), originY: p.y, boxes: measure(), dy: 0, slot: null })
    }
  }

  // The day's preset is its first header, held as the selector on top. With
  // it on the first line nothing can be dropped above it.
  const primary = kinds.indexOf('header')
  const minSlot = primary === 0 ? 1 : 0
  const presetName = primary >= 0 ? headerName(lines[primary]) : ''

  const handleRowDown = (e: React.PointerEvent<HTMLDivElement>, line: number) => {
    if (e.button !== 0 || press.current) return
    const target = e.target as HTMLElement
    if (target.closest('.proper-action')) return
    const chip = target.closest<HTMLElement>('[data-field]')
    const p: Press = {
      line,
      field: kinds[line] === 'exercise' && chip ? chip.dataset.field as Field : null,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      el: e.currentTarget,
      timer: 0,
      held: false,
    }
    p.timer = window.setTimeout(() => onHold(p), HOLD_MS)
    press.current = p
  }

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p || e.pointerId !== p.pointerId) return
    if (!p.held) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > HOLD_SLOP) endPress()
      return
    }
    const dy = e.clientY - p.y
    if (adjust) {
      const steps = Math.round(-dy / STEP_PX)
      if (steps !== adjust.steps) {
        navigator.vibrate?.(4)
        setAdjust({ ...adjust, steps })
      }
    } else if (drag) {
      setDrag({ ...drag, dy, slot: pickSlot(drag.boxes, drag.start, drag.count, dy, maxDropSlot(lines), minSlot) })
    }
  }

  const handleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p || e.pointerId !== p.pointerId) return
    endPress()
    if (!p.held) { handleTap(p.line); return }
    if (adjust) {
      setAdjust(null)
      const next = stepValues(adjust.base, adjust.field, adjust.steps)
      if (next !== adjust.base) {
        const out = [...lines]
        out[adjust.line] = writeLine(out[adjust.line], next)
        onChange(out.join('\n'))
      }
    }
    if (drag) {
      setDrag(null)
      if (drag.slot !== null) onChange(moveLines(lines, drag.start, drag.count, drag.slot).lines.join('\n'))
    }
  }

  const handleCancel = () => {
    endPress()
    setAdjust(null)
    setDrag(null)
  }

  const handleTap = (line: number) => {
    if (kinds[line] === 'blank') return
    setOpen(o => (o === line ? null : line))
    onCursorLine(line)
  }

  const removeLine = (line: number) => {
    const out = [...lines]
    out.splice(line, 1)
    const after = out.join('\n')
    const ex = parseLine(lines[line]).exercise
    setUndo({ line, before: value, after, label: ex?.name || headerName(lines[line]) || lines[line].trim() })
    setOpen(null)
    onChange(after)
  }

  const duplicateLine = (line: number) => {
    const out = [...lines]
    out.splice(line + 1, 0, lines[line])
    onChange(out.join('\n'))
  }

  // Canonical names on the day, so a preset's ghosts leave out what's already here.
  const onDay = useMemo(() => {
    const set = new Set<string>()
    for (const line of lines) {
      const n = parseLine(line).exercise?.name
      if (n) set.add(aliases[normalizeName(n)] ?? normalizeName(n))
    }
    return set
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, aliases])

  // What the preset held last time and the day doesn't have yet.
  const presetNorm = presetName.toLowerCase()
  const ghosts = !presetNorm || dismissed.has(presetNorm) ? [] : (templates.get(presetNorm) ?? []).filter(l => {
    const n = parseLine(l).exercise?.name
    return n !== undefined && !onDay.has(aliases[normalizeName(n)] ?? normalizeName(n))
  })

  // ── Rendering ──
  const dragging = drag !== null
  const lifted = (i: number) => drag !== null && i >= drag.start && i < drag.start + drag.count
  const trailing = (i: number) => lines.slice(i).every(isBlank)

  const renderValues = (v: LineValues, line: number | null) => {
    const live = adjust && line !== null && adjust.line === line ? adjust.field : null
    const w = weightLabel(v)
    const chip = (field: Field, content: React.ReactNode) => (
      <span className={`proper-chip${live === field ? ' adjusting' : ''}`} data-field={field}>
        {content}
        {live === field && <span className="proper-bubble">{bubbleLabel(v, field)}</span>}
      </span>
    )
    return (
      <span className="proper-values">
        {chip('weight', <>{w.value}{w.unit && <span className="proper-unit">{w.unit}</span>}</>)}
        {chip('reps', v.reps)}
        <span className="proper-x">x</span>
        {chip('sets', v.sets)}
      </span>
    )
  }

  const actionBtn = (label: string, icon: React.ReactNode, onClick: () => void, danger = false) => (
    <button
      type="button"
      className={`proper-action${danger ? ' danger' : ''}`}
      onPointerDown={tap}
      onClick={onClick}
      aria-label={label}
      tabIndex={-1}
    >
      {icon}
    </button>
  )

  const rowProps = (i: number, cls: string) => ({
    'data-line': i,
    className: `${cls}${open === i ? ' open' : ''}${swapLine === i ? ' marked' : ''}${lifted(i) ? ' lifted' : ''}`,
    style: lifted(i) ? { transform: `translateY(${drag!.dy}px)` } : undefined,
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => handleRowDown(e, i),
  })

  const renderExercise = (raw: string, i: number) => {
    const base = readValues(raw, weightUnit)!
    const v = adjust?.line === i ? stepValues(adjust.base, adjust.field, adjust.steps) : base
    const ex = parseLine(v === base ? raw : writeLine(raw, v), bodyweightKg).exercise!
    const prev = previousExercises.get(normalizeName(ex.name))
    const trend = prev ? buildTrend(ex, prev, weightUnit, showDownTrend) : null
    const isNew = !prev && !isKnownName(ex.name, knownPast, todayCounts)
    return (
      <div key={i} {...rowProps(i, 'proper-row')}>
        <div className="proper-box">
          <span className={`proper-name${ex.name ? '' : ' unnamed'}`}>{ex.name || 'Untitled'}</span>
          {renderValues(v, i)}
          <span className="proper-actions">
            {actionBtn('Swap exercise', <ArrowLeftRight size={15} strokeWidth={2.25} />, () => onSwapLine(i))}
            {actionBtn('Duplicate', <Copy size={15} strokeWidth={2.25} />, () => duplicateLine(i))}
            {actionBtn('Remove', <Trash2 size={15} strokeWidth={2.25} />, () => removeLine(i), true)}
          </span>
        </div>
        <span className="proper-side">
          {trend && <span className="trend">{trend}</span>}
          {isNew && <span className="new-label">New</span>}
        </span>
      </div>
    )
  }

  // A second header, from a day written in the note with more than one
  // preset. Proper mode has no place for it, so it shows as a divider that can
  // be removed; picking the preset again folds it away too.
  const renderHeader = (raw: string, i: number) => (
    <div key={i} {...rowProps(i, 'proper-text proper-divider')}>
      <span className="proper-text-body">#{headerName(raw)}</span>
      <span className="proper-actions">
        {actionBtn('Remove header', <Trash2 size={15} strokeWidth={2.25} />, () => removeLine(i), true)}
      </span>
    </div>
  )

  const renderText = (raw: string, i: number) => (
    <div key={i} {...rowProps(i, 'proper-text')}>
      <span className="proper-text-body">{raw.trim()}</span>
      <span className="proper-actions">
        {actionBtn('Remove line', <Trash2 size={15} strokeWidth={2.25} />, () => removeLine(i), true)}
      </span>
    </div>
  )

  const selector = (
    <button
      key="preset"
      type="button"
      className={`proper-preset${presetName ? '' : ' empty'}${swapLine === primary && primary >= 0 ? ' marked' : ''}`}
      onPointerDown={tap}
      onClick={onPickPreset}
    >
      <span className="proper-hash">#</span>
      <span className="proper-preset-name">{presetName || 'Choose a preset'}</span>
      <ChevronDown size={16} strokeWidth={2.25} className="proper-preset-chevron" />
    </button>
  )

  const listEnd = (
    <div key="end" className="proper-block-end">
      {ghosts.map((g, n) => {
        const v = readValues(g, weightUnit)!
        return (
          <div
            key={n}
            className="proper-row ghost"
            onPointerDown={tap}
            onClick={() => onChange(appendLines(lines, [g]).join('\n'))}
          >
            <div className="proper-box">
              <span className="proper-name">{parseLine(g).exercise!.name}</span>
              {renderValues(v, null)}
            </div>
          </div>
        )
      })}
      {ghosts.length > 0 && (
        <div className="proper-ghost-actions">
          <button className="data-btn" onPointerDown={tap}
            onClick={() => onChange(appendLines(lines, ghosts).join('\n'))}>
            Apply all
          </button>
          <button className="data-btn data-btn-ghost" onPointerDown={tap}
            onClick={() => setDismissed(d => new Set(d).add(presetNorm))}>
            Skip
          </button>
        </div>
      )}
      <button className="proper-add" onPointerDown={tap} onClick={onAddExercise} aria-label="Add exercise">
        <Plus size={16} strokeWidth={2.25} />
      </button>
    </div>
  )

  const showUndo = undo !== null && undo.after === value
  const undoRow = showUndo && (
    <div key="undo" className="proper-undo">
      <span className="proper-undo-label">Removed {undo.label}</span>
      <button className="data-btn" onPointerDown={tap} onClick={() => { onChange(undo.before); setUndo(null) }}>
        Undo
      </button>
    </div>
  )

  // Every line keeps an element in order — the preset's own header as an
  // empty one, since its selector is drawn above them all — so the drop
  // slots can be measured line for line.
  const rows: React.ReactNode[] = [selector]
  lines.forEach((raw, i) => {
    if (showUndo && undo.line === i) rows.push(undoRow)
    switch (kinds[i]) {
      case 'exercise': rows.push(renderExercise(raw, i)); break
      case 'text':     rows.push(renderText(raw, i)); break
      case 'header':
        rows.push(i === primary
          ? <div key={i} data-line={i} className="proper-gap trailing" />
          : renderHeader(raw, i))
        break
      case 'blank':
        rows.push(<div key={i} data-line={i} className={`proper-gap${trailing(i) || i === primary + 1 ? ' trailing' : ''}`} />)
    }
  })
  if (showUndo && undo.line >= lines.length) rows.push(undoRow)
  rows.push(listEnd)

  return (
    <div
      ref={rootRef}
      className={`proper${dragging ? ' dragging' : ''}${adjust ? ' adjusting' : ''}`}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleCancel}
      onContextMenu={e => e.preventDefault()}
    >
      {rows}
      {drag?.slot != null && (
        <div className="line-drop proper-drop" aria-hidden="true" style={{ top: slotY(drag.boxes, drag.slot) - 3 }} />
      )}
    </div>
  )
}
