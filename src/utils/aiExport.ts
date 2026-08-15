import { getAllDayKeys, loadDay, dateToKey } from './storage'
import { parseLine, normalizeName, type Exercise } from './parser'
import { getBwOn, loadBwHistory } from './bodyweight'
import { loadAliases } from './aliases'
import { getSavedWeightUnit, toDisplayWeight, type WeightUnit, type AiRange } from './settings'

/**
 * Builds a Markdown report of the log, shaped for pasting into an AI chat.
 *
 * Markdown over JSON: the same log costs roughly a third of the tokens with no
 * braces, quotes or repeated key names, and the summaries up top mean the model
 * can answer "am I progressing on bench" without re-deriving it from 400 lines.
 * Everything is normalized here — aliases resolved, bodyweight expressions
 * resolved to real kg — so the reader never has to guess at the app's syntax.
 */

export type ExportRange = AiRange

export const EXPORT_RANGE_LABELS: Record<ExportRange, string> = {
  '1m':  '1 month',
  '3m':  '3 months',
  '1y':  '1 year',
  'all': 'all time',
}

// ── Formatting helpers ────────────────────────────────────────────────────────

/** At most one decimal, no trailing ".0" — keeps numbers short. */
function n1(v: number): string {
  const r = Math.round(v * 10) / 10
  return String(r)
}

function n0(v: number): string {
  return String(Math.round(v))
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function weekdayOf(date: string): string {
  return WEEKDAYS[toDate(date).getDay()]
}

/** Monday-based week start, as YYYY-MM-DD. */
function weekStart(date: string): string {
  const dt = toDate(date)
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7))
  return dateToKey(dt)
}

function cutoffFor(range: ExportRange): string | null {
  if (range === 'all') return null
  const d = new Date()
  if (range === '1m')      d.setMonth(d.getMonth() - 1)
  else if (range === '3m') d.setMonth(d.getMonth() - 3)
  else                     d.setFullYear(d.getFullYear() - 1)
  return dateToKey(d)
}

/**
 * The weight column: the effective per-rep load, plus the original expression
 * when the exercise is bodyweight-based, so "bw+10=82" reads as both what was
 * written and what it actually weighed that day.
 */
function weightCell(ex: Exercise, unit: WeightUnit): string {
  const eff = n1(toDisplayWeight(ex.weightKg, unit))
  if (!ex.bodyweight || !ex.bwExpr) return eff
  switch (ex.bwExpr.op) {
    case 'plain': return `bw=${eff}`
    case 'add':   return `bw${ex.bwExpr.offset >= 0 ? '+' : ''}${n1(ex.bwExpr.offset)}=${eff}`
    case 'mul':   return `bw*${n1(ex.bwExpr.factor)}=${eff}`
  }
}

// ── Report ────────────────────────────────────────────────────────────────────

interface ExStat {
  displayName: string
  dates:    Set<string>
  sets:     number
  reps:     number
  heaviest: number  // kg
  load:     number  // kg
  first:    string
  last:     string
}

interface WeekStat {
  dates: Set<string>
  sets:  number
  load:  number  // kg
}

export function buildAiExport(range: ExportRange, unit = getSavedWeightUnit()): string {
  const aliases = loadAliases()
  const cutoff  = cutoffFor(range)
  // With no bodyweight ever logged the parser falls back to a 60 kg assumption.
  // Printing that as if it were measured would be a lie, so it stays out of the
  // session headers and gets called out once instead.
  const hasBw   = loadBwHistory().length > 0
  const inRange = getAllDayKeys().filter(d => !cutoff || d >= cutoff)  // ascending

  // Walk newest → oldest so the first spelling we meet for an exercise is the
  // most recent one; that name is then used for every older line too, which is
  // what makes the report's names actually canonical. Sessions are reversed
  // back to chronological order before rendering.
  const dates = [...inRange].reverse()

  const byExercise = new Map<string, ExStat>()
  const byWeek     = new Map<string, WeekStat>()
  const sessions: string[] = []

  let sessionCount = 0
  let lineCount    = 0
  let totalSets    = 0
  let totalReps    = 0
  let totalLoadKg  = 0
  let firstDate    = ''
  let lastDate     = ''

  for (const date of dates) {
    const day = loadDay(date)
    if (!day) continue

    const bw     = getBwOn(date)
    const parsed = day.rawText.split('\n').map(l => parseLine(l, bw))
    if (!parsed.some(p => p.exercise)) continue  // empty or notes-only day

    sessionCount++
    if (!lastDate) lastDate = date
    firstDate = date
    const body: string[] = []
    let dayLoad = 0
    let daySets = 0

    for (const p of parsed) {
      const trimmed = p.raw.trim()

      if (p.exercise) {
        const ex   = p.exercise
        const norm = normalizeName(ex.name)
        const key  = aliases[norm] ?? norm
        const loadKg = ex.weightKg * ex.volume

        const stat = byExercise.get(key) ?? {
          displayName: ex.name || key, dates: new Set<string>(), sets: 0, reps: 0,
          heaviest: 0, load: 0, first: date, last: date,
        }
        stat.dates.add(date)
        stat.sets    += ex.sets
        stat.reps    += ex.volume
        stat.heaviest = Math.max(stat.heaviest, ex.weightKg)
        stat.load    += loadKg
        stat.first    = date   // walking backwards: the last write is the oldest date
        byExercise.set(key, stat)

        const name = stat.displayName
        body.push(
          `${name} | ${weightCell(ex, unit)} | ${n1(ex.reps)}x${n1(ex.sets)} | ` +
          `${n0(toDisplayWeight(loadKg, unit))}`,
        )

        lineCount++
        daySets    += ex.sets
        dayLoad    += loadKg
        totalReps  += ex.volume
        continue
      }

      if (p.bodyweightEntry !== undefined) continue  // shown in the session header
      if (!trimmed) continue

      if (trimmed.startsWith('#')) {
        const label = trimmed.replace(/^#+\s*/, '')
        if (label) body.push(`#${label}`)
      } else {
        body.push(`> ${trimmed}`)   // free-text note the parser didn't claim
      }
    }

    totalSets   += daySets
    totalLoadKg += dayLoad

    const wk = byWeek.get(weekStart(date)) ?? { dates: new Set<string>(), sets: 0, load: 0 }
    wk.dates.add(date)
    wk.sets += daySets
    wk.load += dayLoad
    byWeek.set(weekStart(date), wk)

    sessions.push(
      `### ${date} ${weekdayOf(date)}` +
      (hasBw ? ` · bw ${n1(toDisplayWeight(bw, unit))}` : '') +
      ` · ${n0(toDisplayWeight(dayLoad, unit))} total\n${body.join('\n')}`,
    )
  }

  sessions.reverse()   // back to chronological

  const out: string[] = []
  const span = sessionCount > 0 ? `${firstDate} → ${lastDate}` : 'no data'

  // ── Header ────────────────────────────────────────────────────────────────
  out.push('# Workout log')
  out.push(
    `Exported ${dateToKey(new Date())} from note-it-down · range: ${EXPORT_RANGE_LABELS[range]} · ` +
    `${sessionCount} session${sessionCount === 1 ? '' : 's'} (${span}) · all weights in ${unit}.`,
  )

  if (sessionCount === 0) {
    out.push('\nNo sessions logged in this range.')
    return out.join('\n')
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  out.push(`
## How to read this
- Sessions run oldest → newest. Each starts with \`### date weekday${hasBw ? ' · bw <bodyweight>' : ''} · <total> total\`.
- \`#label\` lines are the routine/split the exercises under them belong to.
- Exercise lines: \`name | weight | reps x sets | load\`
  - \`weight\` = ${unit} per rep. \`bw=82\` means the movement is bodyweight-only and weighed
    82 ${unit} that day; \`bw+10=92\` = bodyweight plus 10 ${unit} added; \`bw*0.5=41\` = about half
    bodyweight moved (e.g. push-ups).
  - \`8x3\` = 8 reps for 3 sets. \`load\` = weight x reps x sets, in ${unit}.
- \`>\` lines are my own free-text notes.
- Exercise names are already de-duplicated: nicknames I use are resolved to one canonical name.
- Caveat: bodyweight movements count my full bodyweight as load, so they can dominate any
  total-load figure. Compare like with like before drawing conclusions from totals.`)

  // ── Totals ────────────────────────────────────────────────────────────────
  const weeksSpan = Math.max(
    1,
    (toDate(lastDate).getTime() - toDate(firstDate).getTime()) / (7 * 86400000),
  )
  const bwHistory = loadBwHistory().filter(e => !cutoff || e.date >= cutoff)

  out.push(`
## Totals
- sessions: ${sessionCount} (${n1(sessionCount / weeksSpan)}/week average)
- exercise lines: ${lineCount} · sets: ${n0(totalSets)} · total reps: ${n0(totalReps)}
- total load moved: ${n0(toDisplayWeight(totalLoadKg, unit))} ${unit}
- distinct exercises: ${byExercise.size}`)

  if (bwHistory.length > 0) {
    const first = bwHistory[0]
    const last  = bwHistory[bwHistory.length - 1]
    out.push(
      `- bodyweight: ${n1(toDisplayWeight(first.weight, unit))} (${first.date}) → ` +
      `${n1(toDisplayWeight(last.weight, unit))} (${last.date})`,
    )
    if (bwHistory.length > 2) {
      out.push(`- bodyweight log: ${bwHistory
        .map(e => `${e.date} ${n1(toDisplayWeight(e.weight, unit))}`)
        .join(' · ')}`)
    }
  } else if (!hasBw) {
    out.push(
      `- bodyweight: never recorded, so bodyweight movements are valued at an assumed ` +
      `${n1(toDisplayWeight(60, unit))} ${unit}. Treat their loads as relative, not absolute.`,
    )
  }

  // ── Per-exercise summary ──────────────────────────────────────────────────
  const exRows = [...byExercise.values()]
    .sort((a, b) => b.dates.size - a.dates.size)
    .map(s =>
      `${s.displayName} | ${s.dates.size} | ${n0(s.sets)} | ${n0(s.reps)} | ` +
      `${n1(toDisplayWeight(s.heaviest, unit))} | ${n0(toDisplayWeight(s.load, unit))} | ` +
      `${s.first} | ${s.last}`,
    )

  out.push(`
## Per exercise
\`name | sessions | sets | total reps | heaviest (${unit}) | total load (${unit}) | first | last\`

${exRows.join('\n')}`)

  // ── Weekly rollup ─────────────────────────────────────────────────────────
  // Weeks with nothing logged are emitted as zero rows rather than skipped —
  // a missing row is invisible, and the gaps are the whole point of this table.
  const weekRows: string[] = []
  const cursor = toDate(weekStart(firstDate))
  const lastWeek = weekStart(lastDate)
  for (;;) {
    const wk = dateToKey(cursor)
    const s = byWeek.get(wk)
    weekRows.push(s
      ? `${wk} | ${s.dates.size} | ${n0(s.sets)} | ${n0(toDisplayWeight(s.load, unit))}`
      : `${wk} | 0 | 0 | 0`)
    if (wk >= lastWeek) break
    cursor.setDate(cursor.getDate() + 7)
  }

  out.push(`
## By week
\`week starting (Mon) | sessions | sets | load (${unit})\` — weeks with no training show as 0.

${weekRows.join('\n')}`)

  // ── Sessions ──────────────────────────────────────────────────────────────
  out.push(`
## Sessions

${sessions.join('\n\n')}`)

  // ── Ask ───────────────────────────────────────────────────────────────────
  out.push(`
## What I want from you
Analyse this log: where am I progressing, where have I plateaued or regressed, what's
imbalanced or missing, and how consistent am I? Cite specific exercises, dates and
numbers from the data above rather than giving generic advice.`)

  return out.join('\n')
}

// ── Stats for the settings UI ─────────────────────────────────────────────────

export interface AiExportStats {
  sessions: number
  chars:    number
  tokens:   number   // rough estimate — English prose and digits run ~4 chars/token
}

export function aiExportStats(text: string): AiExportStats {
  return {
    sessions: (text.match(/^### /gm) ?? []).length,
    chars:    text.length,
    tokens:   Math.round(text.length / 4),
  }
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `~${tokens}`
  return `~${(tokens / 1000).toFixed(tokens < 10000 ? 1 : 0)}k`
}

// ── Delivery ──────────────────────────────────────────────────────────────────

/** Clipboard API needs a secure context; fall back to a throwaway textarea. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export function downloadMarkdown(text: string): void {
  const blob = new Blob([text], { type: 'text/markdown' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `note-it-down-log-${dateToKey(new Date())}.md`
  a.click()
  URL.revokeObjectURL(url)
}
