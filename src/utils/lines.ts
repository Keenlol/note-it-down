import { parseLine, type BwExpr } from './parser'
import type { WeightUnit } from './settings'

// Line-level editing of a day's note. The text stays the one source of truth:
// both editors — the note and Proper mode — change it only through these, so
// a line moved, added or rewritten in one reads back the same in the other.

const LBS_TO_KG = 0.453592

export function isHeaderLine(line: string): boolean {
  if (!line.trim().startsWith('#')) return false
  const p = parseLine(line)
  return p.exercise === null && p.bodyweightEntry === undefined
}

export const isBlank = (line: string | undefined) => line !== undefined && line.trim() === ''

/**
 * Lines that move together when `line` is dragged: just itself, or for a "#"
 * header its whole preset — up to the next header, minus trailing blank lines,
 * which stay behind as the gap between blocks.
 */
export function blockRange(lines: string[], line: number): { start: number; count: number } {
  if (!isHeaderLine(lines[line])) return { start: line, count: 1 }
  let end = line + 1
  while (end < lines.length && !isHeaderLine(lines[end])) end++
  while (end > line + 1 && lines[end - 1].trim() === '') end--
  return { start: line, count: end - line }
}

/**
 * Move `count` lines from `start` to before line `slot` (indices before the
 * move); returns the new lines and where the block's first line landed.
 *
 * A preset block that sat apart from its neighbours with blank lines keeps
 * that spacing: the hole it leaves closes up to a single gap, and it is set
 * apart again wherever it lands. Single lines just move.
 */
export function moveLines(
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

// ── Drop slots ──────────────────────────────────────────────────────────────

export interface LineBox { top: number; height: number }

export function slotY(boxes: LineBox[], slot: number): number {
  if (slot < boxes.length) return boxes[slot].top
  const last = boxes[boxes.length - 1]
  return last.top + last.height
}

/**
 * Gap the dragged block would land in. Moving up, its top edge picks the gap;
 * moving down, its bottom edge — so a block swaps with its neighbour once it is
 * halfway past it. Null while that gap is the block's own place. Nothing lands
 * past `maxSlot`, which keeps a trailing newline the last thing in the note,
 * nor before `minSlot`.
 */
export function pickSlot(
  boxes: LineBox[], start: number, count: number, dy: number, maxSlot: number, minSlot = 0,
): number | null {
  const first = boxes[start]
  const last = boxes[start + count - 1]
  const edge = dy < 0 ? first.top + dy : last.top + last.height + dy
  let best = minSlot
  let bestDist = Infinity
  for (let k = minSlot; k <= maxSlot; k++) {
    const d = Math.abs(slotY(boxes, k) - edge)
    if (d < bestDist) { best = k; bestDist = d }
  }
  return best >= start && best <= start + count ? null : best
}

/** The empty line after a trailing newline stays last. */
export function maxDropSlot(lines: string[]): number {
  return lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
}

// ── Blocks ──────────────────────────────────────────────────────────────────

/**
 * Lines added in Proper mode go at the end of the note, just past its last
 * written line — which, with the day's one preset on top, is in that preset.
 */
export function appendLines(lines: string[], add: string[]): string[] {
  let at = lines.length
  while (at > 0 && isBlank(lines[at - 1])) at--
  const out = [...lines]
  out.splice(at, 0, ...add)
  return out
}

/**
 * Proper mode keeps one preset per day: its header is the first line. Setting
 * it drops every other header, so lines that sat under a second preset now
 * belong to this one.
 */
export function setDayPreset(lines: string[], name: string): string[] {
  const rest = lines.filter(l => !isHeaderLine(l))
  while (rest.length > 0 && isBlank(rest[0])) rest.shift()
  return [`# ${name}`, ...rest]
}

// ── Values ──────────────────────────────────────────────────────────────────

/** An exercise line's figures as Proper mode edits them. */
export interface LineValues {
  /** Load in `unit` — or, for a bodyweight line, the bw expression. */
  weight: number
  unit: WeightUnit
  bw: BwExpr | null
  reps: number
  sets: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** The unit a line spells out, if any. Bare numbers read in the default unit. */
function explicitUnit(raw: string): WeightUnit | null {
  if (/\d\s*kg\b/i.test(raw)) return 'kg'
  if (/\d\s*(?:lbs?|pounds?)\b/i.test(raw)) return 'lbs'
  return null
}

export function readValues(raw: string, defaultUnit: WeightUnit): LineValues | null {
  const ex = parseLine(raw).exercise
  if (!ex) return null
  const unit = explicitUnit(raw) ?? defaultUnit
  return {
    weight: ex.bodyweight ? 0 : round1(unit === 'lbs' ? ex.weightKg / LBS_TO_KG : ex.weightKg),
    unit,
    bw: ex.bodyweight ? (ex.bwExpr ?? { op: 'plain' }) : null,
    reps: ex.reps,
    sets: ex.sets,
  }
}

const num = (n: number) => `${round1(n)}`

/** The load as it is written: "60", "60kg", "bw", "bw+10", "bw*1.5". */
export function loadToken(v: LineValues, raw: string): string {
  if (v.bw) {
    switch (v.bw.op) {
      case 'plain': return 'bw'
      case 'add':   return v.bw.offset === 0 ? 'bw' : `bw${v.bw.offset > 0 ? '+' : '-'}${num(Math.abs(v.bw.offset))}`
      case 'mul':   return `bw*${num(v.bw.factor)}`
    }
  }
  return `${num(v.weight)}${explicitUnit(raw) ?? ''}`
}

/**
 * "8x3" reads as 8 reps of 3 sets because the parser takes the larger number
 * for reps. When there are fewer reps than sets that guess is wrong, so the
 * sets get spelled out.
 */
function repsSetsToken(reps: number, sets: number): string {
  return reps < sets ? `${num(reps)}x${num(sets)}s` : `${num(reps)}x${num(sets)}`
}

/** The name as typed, when it all comes before the numbers; else the parsed name. */
function namePart(raw: string): string {
  const p = parseLine(raw)
  const names = p.nameRanges
  const firstNum = Math.min(...p.highlights.map(h => h.start))
  if (names.length > 0 && names[names.length - 1].end <= firstNum) {
    return raw.slice(names[0].start, names[names.length - 1].end)
  }
  return p.exercise?.name ?? ''
}

/**
 * Write a line back in canonical form — "Name load repsxsets" — keeping the
 * line's indent, its name as typed and any unit it spelled out. Only lines
 * Proper mode changes go through here, so untouched lines keep their wording.
 */
export function writeLine(raw: string, v: LineValues): string {
  const indent = raw.match(/^\s*/)![0]
  const name = namePart(raw)
  return `${indent}${name ? name + ' ' : ''}${loadToken(v, raw)} ${repsSetsToken(v.reps, v.sets)}`
}

/** A fresh line for an exercise that has never been logged. */
export function newExerciseLine(name: string): string {
  return `${name.trim()} 0 8x3`
}
