export interface Exercise {
  name: string
  weight: string
  repsXsets: string
}

export interface ParsedLine {
  raw: string
  exercise: Exercise | null
}

const WEIGHT_RE = /^\d+(?:\.\d+)?(?:kg|lbs?|bw)?$/i
const REPS_RE = /^\d+x\d+$/i

export function parseLine(line: string): ParsedLine {
  const tokens = line.trimEnd().split(/\s+/).filter(Boolean)
  if (tokens.length >= 3) {
    const last = tokens[tokens.length - 1]
    const secondLast = tokens[tokens.length - 2]
    if (REPS_RE.test(last) && WEIGHT_RE.test(secondLast)) {
      return {
        raw: line,
        exercise: {
          name: tokens.slice(0, tokens.length - 2).join(' '),
          weight: secondLast,
          repsXsets: last,
        },
      }
    }
  }
  return { raw: line, exercise: null }
}

export function countExercises(text: string): number {
  return text.split('\n').filter(line => parseLine(line).exercise !== null).length
}
