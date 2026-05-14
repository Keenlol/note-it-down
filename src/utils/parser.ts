const LBS_TO_KG = 0.453592
export const ASSUMED_BW_KG = 60

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

export interface ParsedLine {
  raw: string
  exercise: Exercise | null
  bodyweightEntry?: number   // set when line is "bodyweight 82" / "bw 82"
  highlights: Range[]        // numeric token ranges (orange)
  nameRanges: Range[]        // word token ranges (for unknown-name underline)
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
  | { kind: 'pair';   start: number; end: number; reps: number; sets: number }
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
      return { kind: 'pair', start: i, end: i + m[0].length, reps, sets }
    },
  },
  { re: /^(\d+(?:\.\d+)?)\s*kg\b/i, build: (m, i) => ({ kind: 'weight', start: i, end: i + m[0].length, kg: parseFloat(m[1]) }) },
  { re: /^(\d+(?:\.\d+)?)\s*(?:lbs?|pounds?)\b/i, build: (m, i) => ({ kind: 'weight', start: i, end: i + m[0].length, kg: parseFloat(m[1]) * LBS_TO_KG }) },
  { re: /^(\d+(?:\.\d+)?)\s*(?:reps?|r)\b/i, build: (m, i) => ({ kind: 'reps', start: i, end: i + m[0].length, n: parseFloat(m[1]) }) },
  { re: /^(\d+(?:\.\d+)?)\s*(?:sets?|s)\b/i, build: (m, i) => ({ kind: 'sets', start: i, end: i + m[0].length, n: parseFloat(m[1]) }) },
  { re: /^\d+(?:\.\d+)?/, build: (m, i) => ({ kind: 'bare', start: i, end: i + m[0].length, n: parseFloat(m[0]) }) },
  { re: /^[^\s\d]+/, build: (m, i) => ({ kind: 'word', start: i, end: i + m[0].length }) },
]

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
 * Detect standalone bodyweight entry: "bodyweight 82", "bw 75.5", "bw 82kg".
 * Lines with more than one number fall through and are parsed as exercises.
 */
function parseBwEntryLine(line: string): ParsedLine | null {
  // Group 1 = keyword+spaces prefix, Group 2 = full weight token (number+optional unit), Group 3 = number only
  const m = /^(\s*(?:bodyweight|bw)\s+)((\d+(?:\.\d+)?)\s*(?:kg)?)\s*$/i.exec(line)
  if (!m) return null
  const weight = parseFloat(m[3])
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

  // Pass 1: words + labeled tokens (take precedence over positional fill)
  for (const t of toks) {
    if (t.kind === 'word') {
      wordRanges.push({ start: t.start, end: t.end })
    } else if (t.kind === 'bw') {
      bodyweight = true
      bwExpr = { op: 'plain' }
      if (weightKg === undefined) weightKg = bodyweightKg
      used.push(t)
    } else if (t.kind === 'bwadd') {
      bodyweight = true
      bwExpr = { op: 'add', offset: t.offset }
      if (weightKg === undefined) weightKg = bodyweightKg + t.offset
      used.push(t)
    } else if (t.kind === 'bwmul') {
      bodyweight = true
      bwExpr = { op: 'mul', factor: t.factor }
      if (weightKg === undefined) weightKg = bodyweightKg * t.factor
      used.push(t)
    } else if (t.kind === 'weight') {
      if (weightKg === undefined) weightKg = t.kg
      used.push(t)
    } else if (t.kind === 'reps') {
      if (reps === undefined) reps = t.n
      used.push(t)
    } else if (t.kind === 'sets') {
      if (sets === undefined) sets = t.n
      used.push(t)
    } else if (t.kind === 'pair') {
      if (reps === undefined) reps = t.reps
      if (sets === undefined) sets = t.sets
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
      const sorted = bares.map(t => t.n).sort((a, b) => a - b)
      sets = sorted[0]
      reps = sorted[1]
      used.push(bares[0], bares[1])
    }
  }

  // Pass 2: bare numbers fill remaining slots in order (weight → reps → sets)
  for (const t of toks) {
    if (t.kind !== 'bare') continue
    if (weightKg === undefined) { weightKg = t.n; used.push(t) }
    else if (reps === undefined) { reps = t.n; used.push(t) }
    else if (sets === undefined) { sets = t.n; used.push(t) }
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
