import { parseLine, type Exercise, type ValueField, type ValueSpan } from './parser'
import type { WeightUnit } from './settings'

// Stepping one of a line's values by hand — the reveal view's hold-and-drag.
// The number is changed where it is written, so the rest of the line keeps
// its wording: "Bench 60kg 3 sets of 8" stays exactly that with 62.5kg.

const round1 = (n: number) => Math.round(n * 10) / 10
const num = (n: number) => `${round1(n)}`
/** A step of `k` from `v`, landing on the step grid — so 61.3 steps up to 62.5 and down to 60. */
function onGrid(v: number, k: number, step: number): number {
  const q = v / step
  const from = k > 0 ? Math.floor(q + 1e-9) : Math.ceil(q - 1e-9)
  return round1((from + k) * step)
}

function replace(raw: string, span: { start: number; end: number }, text: string): string {
  return raw.slice(0, span.start) + text + raw.slice(span.end)
}

/** The unit a written weight is in: its own, or the default for a bare number. */
function unitOf(raw: string, span: ValueSpan, defaultUnit: WeightUnit): WeightUnit {
  const token = raw.slice(span.token.start, span.token.end)
  if (/kg/i.test(token)) return 'kg'
  if (/lb|pound/i.test(token)) return 'lbs'
  return defaultUnit
}

const same = (a: Exercise, b: Exercise, skip: ValueField) =>
  (skip === 'weight' || round1(a.weightKg) === round1(b.weightKg)) &&
  (skip === 'reps' || a.reps === b.reps) &&
  (skip === 'sets' || a.sets === b.sets)

/**
 * `raw` with `field` stepped `k` times: weight by 2.5 kg / 5 lb (a bodyweight
 * offset likewise, a "bw×n" factor by 0.1), reps and sets by one. Returns raw
 * unchanged when the value isn't written on the line or can't move further.
 */
export function stepLine(raw: string, field: ValueField, k: number, defaultUnit: WeightUnit): string {
  const p = parseLine(raw)
  const ex = p.exercise
  const span = p.values?.[field]
  if (!ex || !span || k === 0) return raw

  let next: string
  if (field === 'weight') {
    const unit = unitOf(raw, span, defaultUnit)
    const step = unit === 'lbs' ? 5 : 2.5
    const op = ex.bwExpr?.op
    if (ex.bodyweight && op === 'mul') {
      const f = parseFloat(raw.slice(span.start, span.end))
      next = replace(raw, span, num(Math.max(0.1, round1(f + k * 0.1))))
    } else if (ex.bodyweight) {
      const o = onGrid(ex.bwExpr?.op === 'add' ? ex.bwExpr.offset : 0, k, step)
      next = replace(raw, span, o === 0 ? 'bw' : `bw${o > 0 ? '+' : '-'}${num(Math.abs(o))}`)
    } else {
      const v = parseFloat(raw.slice(span.start, span.end))
      next = replace(raw, span, num(Math.max(0, onGrid(v, k, step))))
    }
  } else {
    const n = Math.min(999, Math.max(1, ex[field] + k))
    if (n === ex[field]) return raw
    next = replace(raw, span, num(n))
    const reps = field === 'reps' ? n : ex.reps
    const sets = field === 'sets' ? n : ex.sets
    // "8x3" and "pullups 10 3" are read larger-number-as-reps, so a step that
    // crosses the other number would swap them. Spell the pair out instead,
    // "3x5s", wherever reps and sets sit side by side.
    const after = parseLine(next).exercise
    const r = p.values?.reps?.token
    const s = p.values?.sets?.token
    if ((!after || after.reps !== reps || after.sets !== sets) && r && s) {
      const both = { start: Math.min(r.start, s.start), end: Math.max(r.end, s.end) }
      const between = raw.slice(Math.min(r.end, s.end), Math.max(r.start, s.start))
      if (r.start === s.start || between.trim() === '') {
        next = replace(raw, both, reps < sets ? `${num(reps)}x${num(sets)}s` : `${num(reps)}x${num(sets)}`)
      }
    }
  }

  const after = parseLine(next).exercise
  const landed = field === 'weight' || (after !== null && after[field] !== ex[field])
  return after && landed && same(after, ex, field) ? next : raw
}
