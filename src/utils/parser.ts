const LBS_TO_KG = 0.453592
export const ASSUMED_BW_KG = 60

// Module-level default unit multiplier.
// 1 = treat bare numbers as kg (default), LBS_TO_KG = treat as lbs.
// Explicit "kg" / "lbs" tokens in the text always override this.
let _unitMul = 1
export function setDefaultWeightUnit(unit: 'kg' | 'lbs') {
  _unitMul = unit === 'lbs' ? LBS_TO_KG : 1
}

export type BwExpr =
  | { op: 'plain' }
  | { op: 'add'; offset: number }  // bw+4, bw-3
  | { op: 'mul'; factor: number }  // bw*1.5, 0.5*bw

export interface Exercise {
  name: string
  weightKg: number
  reps: number
  sets: number
  bodyweight: boolean
  bwExpr?: BwExpr   // present when bodyweight=true; describes the formula
  volume: number
}

export interface Range {
  start: number
  end: number
}

/**
 * Where one of an exercise's values is written: the digits to rewrite, and
 * the whole token they sit in ("8" of "8x3", "10" of "bw+10"). A plain "bw"
 * has no digits, so its span is the token itself.
 */
export interface ValueSpan extends Range {
  token: Range
}

export type ValueField = 'weight' | 'reps' | 'sets'

export interface ParsedLine {
  raw: string
  exercise: Exercise | null
  bodyweightEntry?: number   // set when line is "bodyweight 82" / "bw 82"
  highlights: Range[]        // numeric token ranges (orange)
  nameRanges: Range[]        // word token ranges (for unknown-name underline)
  /** Where each value is written — absent for one that was assumed (an unwritten bodyweight). */
  values?: Partial<Record<ValueField, ValueSpan>>
}

type Tok =
  | { kind: 'ws';     start: number; end: number }
  | { kind: 'word';   start: number; end: number }
  | { kind: 'bw';     start: number; end: number }
  | { kind: 'bwadd';  start: number; end: number; offset: number }
  | { kind: 'bwmul';  start: number; end: number; factor: number }
  | { kind: 'weight'; start: number; end: number; kg: number }
  | { kind: 'reps';   start: number; end: number; n: number }
  | { kind: 'sets';   start: number; end: number; n: number }
  | { kind: 'pair';   start: number; end: number; reps: number; sets: number; repsFirst: boolean }
  | { kind: 'bare';   start: number; end: number; n: number }

const PATTERNS: Array<{ re: RegExp; build: (m: RegExpExecArray, i: number) => Tok }> = [
  { re: /^\s+/, build: (m, i) => ({ kind: 'ws', start: i, end: i + m[0].length }) },

  // n×bw  e.g. "0.5×bw", "1.5*bodyweight"  — must precede bare so "0.5" isn't eaten first
  {
    re: /^(\d+(?:\.\d+)?)\s*[x*×]\s*(?:bw|bodyweight)\b/i,
    build: (m, i) => ({ kind: 'bwmul', start: i, end: i + m[0].length, factor: parseFloat(m[1]) }),
  },
  // bw×n  e.g. "bw*1.5", "bwx2"
  {
    re: /^(?:bw|bodyweight)\s*[x*×]\s*(\d+(?:\.\d+)?)/i,
    build: (m, i) => ({ kind: 'bwmul', start: i, end: i + m[0].length, factor: parseFloat(m[1]) }),
  },
  // bw±n  e.g. "bw+4", "bw - 3", "bodyweight+10"
  {
    re: /^(?:bw|bodyweight)\s*([+-])\s*(\d+(?:\.\d+)?)/i,
    build: (m, i) => ({ kind: 'bwadd', start: i, end: i + m[0].length, offset: m[1] === '-' ? -parseFloat(m[2]) : parseFloat(m[2]) }),
  },
  // plain bw — must come after bwadd/bwmul patterns
  { re: /^(?:bw|bodyweight)\b/i, build: (m, i) => ({ kind: 'bw', start: i, end: i + m[0].length }) },

  {
    re: /^(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)(\s*(?:reps?|r|sets?|s))?\b/i,
    build: (m, i) => {
      const a = parseFloat(m[1])
      const b = parseFloat(m[2])
      const suffix = (m[3] || '').replace(/\s+/g, '').toLowerCase()
      let reps: number, sets: number
      if (/^(reps?|r)$/.test(suffix)) { reps = b; sets = a }
      else if (/^(sets?|s)$/.test(suffix)) { sets = b; reps = a }
      else if (a < b) { sets = a; reps = b }
      else { sets = b; reps = a }
      const repsFirst = /^(sets?|s)$/.test(suffix) || (!/^(reps?|r)$/.test(suffix) && a >= b)
      return { kind: 'pair', start: i, end: i + m[0].length, reps, sets, repsFirst }
    },
  },
  { re: /^(\d+(?:\.\d+)?)\s*kg\b/i, build: (m, i) => ({ kind: 'weight', start: i, end: i + m[0].length, kg: parseFloat(m[1]) }) },
  { re: /^(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)\b/i, build: (m, i) => ({ kind: 'weight', start: i, end: i + m[0].length, kg: parseFloat(m[1]) * LBS_TO_KG }) },
  { re: /^(\d+(?:\.\d+)?)\s*(?:reps?|r)\b/i, build: (m, i) => ({ kind: 'reps', start: i, end: i + m[0].length, n: parseFloat(m[1]) }) },
  { re: /^(\d+(?:\.\d+)?)\s*(?:sets?|s)\b/i, build: (m, i) => ({ kind: 'sets', start: i, end: i + m[0].length, n: parseFloat(m[1]) }) },
  { re: /^\d+(?:\.\d+)?/, build: (m, i) => ({ kind: 'bare', start: i, end: i + m[0].length, n: parseFloat(m[0]) }) },
  { re: /^[^\s\d]+/, build: (m, i) => ({ kind: 'word', start: i, end: i + m[0].length }) },
]

/** Every number written inside a token, in order. */
function numbersIn(line: string, t: Tok): Range[] {
  const out: Range[] = []
  const re = /\d+(?:\.\d+)?/g
  const text = line.slice(t.start, t.end)
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ start: t.start + m.index, end: t.start + m.index + m[0].length })
  }
  return out
}

function spanOf(line: string, t: Tok, nth = 0): ValueSpan {
  const token = { start: t.start, end: t.end }
  // A plain or offset "bw" is rewritten whole; everything else just its digits.
  if (t.kind === 'bw' || t.kind === 'bwadd') return { ...token, token }
  return { ...(numbersIn(line, t)[nth] ?? token), token }
}

function tokenize(line: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < line.length) {
    let matched = false
    for (const p of PATTERNS) {
      const m = p.re.exec(line.slice(i))
      if (m) {
        toks.push(p.build(m, i))
        i += m[0].length
        matched = true
        break
      }
    }
    if (!matched) i += 1
  }
  return toks
}

/**
 * Detect standalone bodyweight entry: "bodyweight 82", "bw 75.5", "bw 82kg",
 * "bw 165lbs". Stored weight is always kg: an explicit unit wins, otherwise the
 * number is read in the active default unit (kg or lbs).
 * Lines with more than one number fall through and are parsed as exercises.
 */
function parseBwEntryLine(line: string): ParsedLine | null {
  // Group 1 = keyword+spaces prefix, Group 2 = full weight token (number+optional unit),
  // Group 3 = number only, Group 4 = optional unit
  const m = /^(\s*(?:bodyweight|bw)\s+)((\d+(?:\.\d+)?)\s*(kg|lbs?|pounds?)?)\s*$/i.exec(line)
  if (!m) return null
  const num = parseFloat(m[3])
  const unit = (m[4] || '').toLowerCase()
  const weight = unit === 'kg' ? num
    : unit ? num * LBS_TO_KG   // lb/lbs/pound/pounds
    : num * _unitMul           // no unit → active default
  const numStart = m[1].length
  const numEnd = numStart + m[2].trimEnd().length
  return {
    raw: line,
    exercise: null,
    bodyweightEntry: weight,
    highlights: [{ start: numStart, end: numEnd }],
    nameRanges: [],
  }
}

export function parseLine(line: string, bodyweightKg: number = ASSUMED_BW_KG): ParsedLine {
  // Bodyweight entry takes precedence
  const bwEntry = parseBwEntryLine(line)
  if (bwEntry) return bwEntry

  const toks = tokenize(line)
  let weightKg: number | undefined
  let reps: number | undefined
  let sets: number | undefined
  let bodyweight = false
  let bwExpr: BwExpr | undefined
  const used: Tok[] = []
  const wordRanges: Range[] = []
  const values: Partial<Record<ValueField, ValueSpan>> = {}

  // Pass 1: words + labeled tokens (take precedence over positional fill)
  for (const t of toks) {
    if (t.kind === 'word') {
      wordRanges.push({ start: t.start, end: t.end })
    } else if (t.kind === 'bw') {
      bodyweight = true
      bwExpr = { op: 'plain' }
      if (weightKg === undefined) { weightKg = bodyweightKg; values.weight = spanOf(line, t) }
      used.push(t)
    } else if (t.kind === 'bwadd') {
      bodyweight = true
      bwExpr = { op: 'add', offset: t.offset }
      if (weightKg === undefined) { weightKg = bodyweightKg + t.offset * _unitMul; values.weight = spanOf(line, t) }
      used.push(t)
    } else if (t.kind === 'bwmul') {
      bodyweight = true
      bwExpr = { op: 'mul', factor: t.factor }
      if (weightKg === undefined) { weightKg = bodyweightKg * t.factor; values.weight = spanOf(line, t) }
      used.push(t)
    } else if (t.kind === 'weight') {
      if (weightKg === undefined) { weightKg = t.kg; values.weight = spanOf(line, t) }
      used.push(t)
    } else if (t.kind === 'reps') {
      if (reps === undefined) { reps = t.n; values.reps = spanOf(line, t) }
      used.push(t)
    } else if (t.kind === 'sets') {
      if (sets === undefined) { sets = t.n; values.sets = spanOf(line, t) }
      used.push(t)
    } else if (t.kind === 'pair') {
      if (reps === undefined) { reps = t.reps; values.reps = spanOf(line, t, t.repsFirst ? 0 : 1) }
      if (sets === undefined) { sets = t.sets; values.sets = spanOf(line, t, t.repsFirst ? 1 : 0) }
      used.push(t)
    }
  }

  // Two-number shorthand: exactly 2 bare numbers with no weight context
  // → assume bodyweight; larger number = reps, smaller = sets
  if (weightKg === undefined && reps === undefined && sets === undefined && !bodyweight) {
    const bares = toks.filter((t): t is Tok & { kind: 'bare'; n: number } => t.kind === 'bare')
    if (bares.length === 2) {
      bodyweight = true
      bwExpr = { op: 'plain' }
      weightKg = bodyweightKg
      const [few, many] = bares[0].n <= bares[1].n ? [bares[0], bares[1]] : [bares[1], bares[0]]
      sets = few.n
      reps = many.n
      values.sets = spanOf(line, few)
      values.reps = spanOf(line, many)
      used.push(bares[0], bares[1])
    }
  }

  // Pass 2: bare numbers fill remaining slots in order (weight → reps → sets)
  for (const t of toks) {
    if (t.kind !== 'bare') continue
    if (weightKg === undefined) { weightKg = t.n * _unitMul; values.weight = spanOf(line, t); used.push(t) }
    else if (reps === undefined) { reps = t.n; values.reps = spanOf(line, t); used.push(t) }
    else if (sets === undefined) { sets = t.n; values.sets = spanOf(line, t); used.push(t) }
  }

  if (reps === undefined || sets === undefined) {
    return { raw: line, exercise: null, highlights: [], nameRanges: [] }
  }

  if (weightKg === undefined) {
    weightKg = bodyweightKg
    bodyweight = true
    bwExpr = { op: 'plain' }
  }

  const name = wordRanges
    .map(r => line.slice(r.start, r.end))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    raw: line,
    exercise: { name, weightKg, reps, sets, bodyweight, bwExpr, volume: reps * sets },
    highlights: used.map(t => ({ start: t.start, end: t.end })),
    nameRanges: wordRanges,
    values,
  }
}

/**
 * Load added on top of bodyweight, in kg, for a bodyweight exercise.
 *   plain bw   → 0
 *   bw+N / bw-N → ±N (converted to kg via the active default unit)
 *   bw×f       → weight − base = weightKg·(1 − 1/f)
 * Non-bodyweight exercises return 0 (their weightKg is the load itself).
 * Used for trend comparison so genuine added load registers while raw
 * bodyweight drift between days does not.
 */
export function bwExtraLoadKg(ex: Exercise): number {
  if (!ex.bodyweight || !ex.bwExpr) return 0
  switch (ex.bwExpr.op) {
    case 'plain': return 0
    case 'add':   return ex.bwExpr.offset * _unitMul
    case 'mul':   return ex.bwExpr.factor === 0 ? 0 : ex.weightKg * (1 - 1 / ex.bwExpr.factor)
  }
}

export function countExercises(text: string): number {
  return text.split('\n').filter(line => parseLine(line).exercise !== null).length
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '')
}

export function totalVolume(text: string, bodyweightKg = ASSUMED_BW_KG): number {
  return text.split('\n').reduce((sum, line) => {
    const p = parseLine(line, bodyweightKg)
    return sum + (p.exercise?.volume ?? 0)
  }, 0)
}

export function isKnownName(
  name: string,
  knownPast: Set<string>,
  todayCounts: Map<string, number>,
): boolean {
  const n = normalizeName(name)
  if (!n) return true
  if (knownPast.has(n)) return true
  for (const k of knownPast) {
    if (k.startsWith(n) || n.startsWith(k)) return true
  }
  if ((todayCounts.get(n) ?? 0) >= 2) return true
  return false
}
