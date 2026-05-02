const LBS_TO_KG = 0.453592
export const ASSUMED_BW_KG = 60

export interface Exercise {
  name: string
  weightKg: number
  reps: number
  sets: number
  bodyweight: boolean
  volume: number
}

export interface Range {
  start: number
  end: number
}

export interface ParsedLine {
  raw: string
  exercise: Exercise | null
  highlights: Range[]   // numeric token ranges (orange)
  nameRanges: Range[]   // word token ranges (for unknown-name underline)
}

type Tok =
  | { kind: 'ws'; start: number; end: number }
  | { kind: 'word'; start: number; end: number }
  | { kind: 'bw'; start: number; end: number }
  | { kind: 'weight'; start: number; end: number; kg: number }
  | { kind: 'reps'; start: number; end: number; n: number }
  | { kind: 'sets'; start: number; end: number; n: number }
  | { kind: 'pair'; start: number; end: number; reps: number; sets: number }
  | { kind: 'bare'; start: number; end: number; n: number }

const PATTERNS: Array<{ re: RegExp; build: (m: RegExpExecArray, i: number) => Tok }> = [
  { re: /^\s+/, build: (m, i) => ({ kind: 'ws', start: i, end: i + m[0].length }) },
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

export function parseLine(line: string): ParsedLine {
  const toks = tokenize(line)
  let weightKg: number | undefined
  let reps: number | undefined
  let sets: number | undefined
  let bodyweight = false
  const used: Tok[] = []
  const wordRanges: Range[] = []

  // Pass 1: words + labeled tokens (take precedence over positional fill)
  for (const t of toks) {
    if (t.kind === 'word') {
      wordRanges.push({ start: t.start, end: t.end })
    } else if (t.kind === 'bw') {
      bodyweight = true
      if (weightKg === undefined) weightKg = ASSUMED_BW_KG
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
    weightKg = ASSUMED_BW_KG
    bodyweight = true
  }

  const name = wordRanges
    .map(r => line.slice(r.start, r.end))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    raw: line,
    exercise: { name, weightKg, reps, sets, bodyweight, volume: weightKg * reps * sets },
    highlights: used.map(t => ({ start: t.start, end: t.end })),
    nameRanges: wordRanges,
  }
}

export function countExercises(text: string): number {
  return text.split('\n').filter(line => parseLine(line).exercise !== null).length
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function isKnownName(
  name: string,
  knownPast: Set<string>,
  todayCounts: Map<string, number>,
): boolean {
  const n = normalizeName(name)
  if (!n) return true
  // Past: exact or prefix match (handles "bench p" → "bench press")
  if (knownPast.has(n)) return true
  for (const k of knownPast) {
    if (k.startsWith(n) || n.startsWith(k)) return true
  }
  // Today: known if this name appears on at least one OTHER line today.
  // (Each line has at most one name, so a count ≥ 2 means another line uses it.)
  if ((todayCounts.get(n) ?? 0) >= 2) return true
  return false
}
