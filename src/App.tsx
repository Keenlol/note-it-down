import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ArrowRight, Eye, Dumbbell, Hash, Settings } from 'lucide-react'
import { Heatmap } from './components/Heatmap'
import { Editor, type Suggestion } from './components/Editor'
import { ExerciseSheet } from './components/ExerciseSheet'
import { PresetSheet } from './components/PresetSheet'
import { SettingsSheet } from './components/SettingsSheet'
import { dateToKey, getAllDayKeys, loadDay, saveDay, todayKey } from './utils/storage'
import { normalizeName, parseLine, countExercises, type ParsedLine, type Exercise } from './utils/parser'
import { loadAliases } from './utils/aliases'
import { exerciseVolumePerDay } from './utils/exercises'
import { presetVolumePerDay } from './utils/presets'
import { getBwOn, setBwEntry, isBwSet } from './utils/bodyweight'
import { tap } from './utils/tap'
import { getSavedAccent, applyAccent, ACCENT_COLORS, type AccentKey, getSavedWeightUnit, type WeightUnit, getSavedSheetHeight, saveSheetHeight } from './utils/settings'
import { setDefaultWeightUnit } from './utils/parser'

type SaveStatus = 'idle' | 'saving' | 'saved'

interface ParsedDay {
  date: string
  rawText: string
  parsedLines: ParsedLine[]
}

function getSuggestion(
  currentText: string,
  cursorPos: number,
  pastDays: ParsedDay[],
): Suggestion | null {
  if (pastDays.length === 0) return null

  const linesBefore = currentText.slice(0, cursorPos).split('\n')
  const lineIndex = linesBefore.length - 1
  const currentLine = linesBefore[lineIndex]

  const allLines = currentText.split('\n')
  if (currentLine.length !== allLines[lineIndex]?.length) return null

  // Today's already-typed exercise names (excluding the line at cursor)
  const todayNames = new Set<string>()
  allLines.forEach((line, i) => {
    if (i === lineIndex) return
    const p = parseLine(line)
    if (p.exercise && p.exercise.name) todayNames.add(normalizeName(p.exercise.name))
  })

  const lowerPrefix = currentLine.toLowerCase()
  let best: { suffix: string; score: number } | null = null

  for (const day of pastDays) {
    // Score: overlap between today's already-typed names and this day's exercise names
    let score = 0
    for (const p of day.parsedLines) {
      if (p.exercise && p.exercise.name && todayNames.has(normalizeName(p.exercise.name))) score++
    }

    // Find first usable line in this day (in original order)
    let usableLine: string | null = null
    for (const p of day.parsedLines) {
      if (!p.exercise || !p.exercise.name) continue
      if (todayNames.has(normalizeName(p.exercise.name))) continue

      if (currentLine === '') {
        usableLine = p.raw
        break
      } else if (p.raw.toLowerCase().startsWith(lowerPrefix) && p.raw.length > currentLine.length) {
        usableLine = p.raw
        break
      }
    }
    if (!usableLine) continue

    if (!best || score > best.score) {
      best = { suffix: usableLine.slice(currentLine.length), score }
    }
  }

  return best ? { suffix: best.suffix, lineIndex } : null
}

// Hash-preset suggestion: triggered on any line starting with '#'.
// Hash-preset suggestion: triggered on any line starting with '#'.
//
// Normalisation rule: preset keys are the content *after* "#" with surrounding spaces
// stripped and lowercased. So "#home", "# home", "#  Home" all share key "home".
// nameSuffix is computed from the content portion only (not the full raw line), so the
// inline ghost is always a clean completion of the name, independent of spacing.
//
// Cases:
//   A       — nothing typed after '#'         → show all names, passive hint
//   B-multi — typed prefix matches >1 preset  → show matching names, passive hint
//   B-single— typed prefix matches exactly 1  → show name ghost + exercises, Enter fills
//   C       — full name typed (B-single where nameSuffix == "")
function getHashPresetSuggestion(
  currentText: string,
  cursorPos: number,
  pastDays: ParsedDay[],
): Suggestion | null {
  if (pastDays.length === 0) return null

  const linesBefore = currentText.slice(0, cursorPos).split('\n')
  const lineIndex = linesBefore.length - 1
  const currentLine = linesBefore[lineIndex]

  const allLines = currentText.split('\n')
  if (currentLine.length !== allLines[lineIndex]?.length) return null

  // Only trigger on lines starting with '#' that aren't parsed as exercises
  if (!currentLine.trimStart().startsWith('#')) return null
  if (parseLine(currentLine).exercise !== null) return null

  // Build preset map: normKey → { rawContent (original case after "#"), exercises[] }
  const presets = new Map<string, { rawContent: string; exercises: string[] }>()

  for (const day of pastDays) { // newest first
    const lines = day.parsedLines
    for (let i = 0; i < lines.length; i++) {
      const p = lines[i]
      if (p.exercise !== null) continue
      if (p.bodyweightEntry !== undefined) continue
      if (!p.raw.trim().startsWith('#')) continue

      const rawName   = p.raw.trim()
      const rawContent = rawName.replace(/^#+\s*/, '') // "# Push Day" → "Push Day"
      const normKey   = rawContent.toLowerCase()       // "push day"
      if (!normKey) continue  // bare "#" with nothing after — skip

      // Collect exercise lines that immediately follow this header
      const exercises: string[] = []
      let j = i + 1
      while (j < lines.length) {
        const next = lines[j]
        if (next.exercise === null && next.bodyweightEntry === undefined &&
            next.raw.trim().startsWith('#')) break  // next header → stop
        if (next.exercise !== null) exercises.push(next.raw)
        j++
      }

      // Newest occurrence wins; only keep presets that actually have exercises
      if (!presets.has(normKey) && exercises.length > 0) {
        presets.set(normKey, { rawContent, exercises })
      }
    }
  }

  if (presets.size === 0) return null

  // Exercise names already typed today (to filter from suggestion)
  const todayNames = new Set<string>()
  allLines.forEach((line, li) => {
    if (li === lineIndex) return
    const p = parseLine(line)
    if (p.exercise?.name) todayNames.add(normalizeName(p.exercise.name))
  })

  // Content after '#' with leading spaces stripped — works for "#home" and "# home" equally
  const typed        = currentLine.trimEnd()
  const afterHash      = typed.slice(typed.indexOf('#') + 1).trimStart() // "Push" | "home" | ""
  const afterHashLower = afterHash.toLowerCase()

  const exLabel = (n: number) => n === 1 ? '1 exercise' : `${n} exercises`
  const withCount = (rawContent: string, exercises: string[]) =>
    `${rawContent} (${exLabel(exercises.length)})`

  // Case A: nothing typed after '#'
  if (afterHash === '') {
    return {
      suffix: '',
      lineIndex,
      presetLines: [...presets.values()].map(v => withCount(v.rawContent, v.exercises)),
      isHint: true,
    }
  }

  // Find all presets whose key starts with what the user typed, sorted alphabetically
  const matches = [...presets.entries()]
    .filter(([k]) => k.startsWith(afterHashLower))
    .sort(([a], [b]) => a.localeCompare(b))

  if (matches.length === 0) return null

  // Case B-multi: more than one match → show names, passive hint (no Enter fill)
  if (matches.length > 1) {
    return {
      suffix: '',
      lineIndex,
      presetLines: matches.map(([, p]) => withCount(p.rawContent, p.exercises)),
      isHint: true,
    }
  }

  // Case B-single / C: exactly one match — show name ghost + exercises, Enter fills
  const [, preset] = matches[0]

  // nameSuffix: remaining characters to finish the preset name (content portion only)
  // e.g. afterHash="Push", rawContent="Push Day" → nameSuffix=" Day"
  const nameSuffix = preset.rawContent.slice(afterHash.length)

  const exercises = preset.exercises.filter(line => {
    const p = parseLine(line)
    return p.exercise && !todayNames.has(normalizeName(p.exercise.name))
  })

  if (exercises.length === 0 && !nameSuffix) return null

  return {
    suffix: nameSuffix + (exercises.length > 0 ? '\n' + exercises.join('\n') : ''),
    lineIndex,
    presetLines: exercises.length > 0 ? exercises : undefined,
    nameSuffix: nameSuffix || undefined,
  }
}

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function offsetDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() + days)
  return dateToKey(date)
}

function namesFromText(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const p = parseLine(line)
    if (p.exercise && p.exercise.name) out.push(normalizeName(p.exercise.name))
  }
  return out
}

/** Scan text for the first "bodyweight 82" entry line and return the weight, or null. */
function extractBwFromText(text: string): number | null {
  for (const line of text.split('\n')) {
    const p = parseLine(line)
    if (p.bodyweightEntry !== undefined) return p.bodyweightEntry
  }
  return null
}

export function App() {
  const [todayText, setTodayText] = useState(() => loadDay(todayKey())?.rawText ?? '')
  const [viewDate, setViewDate] = useState<string | null>(null)
  const [pastText, setPastText] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(() =>
    loadDay(todayKey()) ? 'saved' : 'idle'
  )
  const [cursorPos, setCursorPos] = useState(0)
  const [pastCursorPos, setPastCursorPos] = useState(0)
  const [dataVersion, setDataVersion] = useState(0)
  const [titleStyle, setTitleStyle] = useState<React.CSSProperties>({})
  const [noteOpacity, setNoteOpacity] = useState(1)
  const [isSwipeAnimating, setIsSwipeAnimating] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [presetSheetOpen, setPresetSheetOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [accentHex, setAccentHex] = useState(() => {
    const key = getSavedAccent()
    return ACCENT_COLORS.find(c => c.key === key)?.hex ?? '#f97316'
  })
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(() => getSavedWeightUnit())
  const [focusedExercise, setFocusedExercise] = useState<string | null>(null)
  const [focusedPreset, setFocusedPreset] = useState<string | null>(null)
  const [aliases, setAliases] = useState<Record<string, string>>(() => loadAliases())
  const [bwVersion, setBwVersion] = useState(0)
  const [sheetHeight, setSheetHeight] = useState<number | undefined>(() => getSavedSheetHeight())
  // Heatmap bloom: bumped each time a new exercise line is completed on the edited day.
  const [bloom, setBloom] = useState<{ date: string; id: number } | null>(null)
  const bloomId = useRef(0)
  const exCountRef = useRef<{ day: string; count: number }>({ day: '', count: -1 })

  // Fire a bloom when a user edit raises the exercise-line count for `day`.
  // Driven only by real edits (typing / preset fill), never by navigation loads,
  // so scrolling to a logged day can't misfire. A day change just re-baselines.
  const fireBloomIfNewLine = useCallback((day: string, newText: string) => {
    const count = countExercises(newText)
    const prev = exCountRef.current
    if (prev.day === day && count > prev.count) {
      bloomId.current += 1
      setBloom({ date: day, id: bloomId.current })
    }
    exCountRef.current = { day, count }
  }, [])
  const heatmapRef = useRef<HTMLDivElement>(null)
  // True once the user has dragged the handle — auto-sizing then stops overriding it.
  const manualSheetHeight = useRef(getSavedSheetHeight() !== undefined)
  const latestSheetHeight = useRef<number | undefined>(getSavedSheetHeight())

  function clampSheetHeight(px: number): number {
    const vh = window.visualViewport?.height ?? window.innerHeight
    return Math.round(Math.max(220, Math.min(px, vh - 72)))
  }

  const handleSheetResize = (px: number) => {
    manualSheetHeight.current = true
    const clamped = clampSheetHeight(px)
    latestSheetHeight.current = clamped
    setSheetHeight(clamped)
  }

  const handleSheetResizeEnd = () => {
    if (latestSheetHeight.current !== undefined) saveSheetHeight(latestSheetHeight.current)
  }

  const filterVolumeMap = useMemo(
    () => {
      if (focusedExercise) return exerciseVolumePerDay(focusedExercise, aliases)
      if (focusedPreset) return presetVolumePerDay(focusedPreset)
      return undefined
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusedExercise, focusedPreset, aliases, dataVersion],
  )

  // Bodyweight applicable on the currently-viewed date
  const currentBw = useMemo(
    () => getBwOn(viewDate ?? todayKey()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewDate, bwVersion],
  )
  const bwSet = useMemo(() => isBwSet(), [bwVersion])

  const hasExercises = useMemo(
    () => todayText.split('\n').some(line => parseLine(line).exercise !== null),
    [todayText]
  )

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pastSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const swipeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pastTextareaRef = useRef<HTMLTextAreaElement>(null)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)

  // All past days, parsed once. Refreshed when viewDate changes
  // (so edits to a past day are reflected when we navigate away).
  const pastDays = useMemo<ParsedDay[]>(() => {
    const today = todayKey()
    return getAllDayKeys()
      .filter(k => k !== today)
      .reverse() // newest first
      .map(date => {
        const rawText = loadDay(date)?.rawText ?? ''
        return { date, rawText, parsedLines: rawText.split('\n').map(parseLine) }
      })
  }, [viewDate])

  // Names from past days only — always considered known. Resolves through aliases
  // so nicknames are also treated as known.
  const knownPast = useMemo(() => {
    const set = new Set<string>()
    for (const day of pastDays) {
      for (const p of day.parsedLines) {
        if (p.exercise?.name) {
          const norm = normalizeName(p.exercise.name)
          const canonical = aliases[norm] ?? norm
          set.add(norm)
          set.add(canonical)
        }
      }
    }
    return set
  }, [pastDays, aliases])

  // Counts of exercise names in the currently-edited text.
  // A name is "known via today" if it appears on at least 2 lines.
  const todayCounts = useMemo(() => {
    const map = new Map<string, number>()
    const source = viewDate ? pastText : todayText
    for (const n of namesFromText(source)) {
      map.set(n, (map.get(n) ?? 0) + 1)
    }
    return map
  }, [todayText, viewDate, pastText])

  useEffect(() => {
    const el = heatmapRef.current
    if (!el) return
    const update = () => {
      const vh = window.visualViewport?.height ?? window.innerHeight
      if (manualSheetHeight.current) {
        // Keep the user's chosen size, but never let it overflow the viewport.
        setSheetHeight(h => (h === undefined ? h : clampSheetHeight(h)))
        return
      }
      const rect = el.getBoundingClientRect()
      setSheetHeight(vh - rect.bottom)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => { ro.disconnect(); window.removeEventListener('resize', update) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const saved = loadDay(todayKey())
    if (saved) setTodayText(saved.rawText)
  }, [])


  // Apply saved accent color and weight unit on first render
  useEffect(() => {
    applyAccent(accentHex)
    setDefaultWeightUnit(weightUnit)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (viewDate) {
      setPastText(loadDay(viewDate)?.rawText ?? '')
    }
  }, [viewDate])

  const navigateDay = useCallback((direction: -1 | 1) => {
    const current = viewDate ?? todayKey()
    const next = offsetDate(current, direction)
    const today = todayKey()
    if (next > today) return
    setViewDate(next === today ? null : next)
    setCursorPos(0)
    setPastCursorPos(0)
  }, [viewDate])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft') navigateDay(-1)
      if (e.key === 'ArrowRight') navigateDay(1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigateDay])

  const handleChange = useCallback((text: string) => {
    setTodayText(text)
    fireBloomIfNewLine(todayKey(), text)
    setSaveStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const date = todayKey()
      saveDay(date, text)
      setSaveStatus('saved')
      setDataVersion(v => v + 1)
      const bw = extractBwFromText(text)
      if (bw !== null) { setBwEntry(date, bw); setBwVersion(v => v + 1) }
    }, 400)
  }, [])

  const handlePastChange = useCallback((text: string) => {
    if (!viewDate) return
    setPastText(text)
    fireBloomIfNewLine(viewDate, text)
    clearTimeout(pastSaveTimer.current)
    const dateSnapshot = viewDate
    pastSaveTimer.current = setTimeout(() => {
      saveDay(dateSnapshot, text)
      setDataVersion(v => v + 1)
      const bw = extractBwFromText(text)
      if (bw !== null) { setBwEntry(dateSnapshot, bw); setBwVersion(v => v + 1) }
    }, 400)
  }, [viewDate])

  const suggestion = useMemo<Suggestion | null>(() => {
    if (viewDate !== null) return null
    return getHashPresetSuggestion(todayText, cursorPos, pastDays)
        ?? getSuggestion(todayText, cursorPos, pastDays)
  }, [todayText, cursorPos, pastDays, viewDate])

  // For past-day editing: suggest only from the day immediately before viewDate
  // All days strictly before the currently-viewed date — used for past-day suggestions.
  // Same pattern as previousExercises: only look back, never at or after the viewed date.
  const daysBeforeView = useMemo<ParsedDay[]>(() => {
    if (!viewDate) return []
    return pastDays.filter(d => d.date < viewDate)
  }, [pastDays, viewDate])

  const pastSuggestion = useMemo<Suggestion | null>(() => {
    if (!viewDate) return null
    return getHashPresetSuggestion(pastText, pastCursorPos, daysBeforeView)
        ?? getSuggestion(pastText, pastCursorPos, daysBeforeView)
  }, [pastText, pastCursorPos, daysBeforeView, viewDate])

  // Most recent prior occurrence of each exercise, for trend indicators.
  // For today: search all past days. For a past day: search only days before it.
  // Most recent prior occurrence of each exercise. Resolves through aliases so
  // nicknames automatically inherit the canonical exercise's trend data.
  const previousExercises = useMemo<Map<string, Exercise>>(() => {
    const map = new Map<string, Exercise>()
    const sources = viewDate ? pastDays.filter(d => d.date < viewDate) : pastDays
    for (const day of sources) {
      const bw = getBwOn(day.date)
      for (const p of day.parsedLines) {
        if (!p.exercise) continue
        // Re-parse bw exercises with the correct bodyweight for that date
        const exercise = p.exercise.bodyweight
          ? (parseLine(p.raw, bw).exercise ?? p.exercise)
          : p.exercise
        const norm = normalizeName(exercise.name)
        const canonical = aliases[norm] ?? norm
        if (!map.has(canonical)) map.set(canonical, exercise)
      }
    }
    for (const [from, to] of Object.entries(aliases)) {
      if (!map.has(from) && map.has(to)) map.set(from, map.get(to)!)
    }
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastDays, viewDate, aliases, bwVersion])

  const handleTabConfirm = useCallback(() => {
    if (!suggestion || !textareaRef.current) return

    const pos = textareaRef.current.selectionStart
    const text = todayText
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1
    const lineContent = text.slice(lineStart, pos)
    const fullLine = lineContent + suggestion.suffix
    const after = text.slice(pos)

    let newText: string
    let newCursor: number

    if (after === '' || after[0] === '\n') {
      newText = text.slice(0, lineStart) + fullLine + (after === '' ? '\n' : after)
      newCursor = lineStart + fullLine.length + 1
    } else {
      newText = text.slice(0, lineStart) + fullLine + after
      newCursor = lineStart + fullLine.length
    }

    setTodayText(newText)
    fireBloomIfNewLine(todayKey(), newText)
    setCursorPos(newCursor)
    setSaveStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveDay(todayKey(), newText)
      setSaveStatus('saved')
      setDataVersion(v => v + 1)
    }, 400)

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newCursor
        textareaRef.current.selectionEnd = newCursor
        textareaRef.current.focus()
      }
    })
  }, [suggestion, todayText])

  const handlePastTabConfirm = useCallback(() => {
    if (!pastSuggestion || !pastTextareaRef.current) return

    const pos = pastTextareaRef.current.selectionStart
    const text = pastText
    const lineStart = text.lastIndexOf('\n', pos - 1) + 1
    const lineContent = text.slice(lineStart, pos)
    const fullLine = lineContent + pastSuggestion.suffix
    const after = text.slice(pos)

    let newText: string
    let newCursor: number

    if (after === '' || after[0] === '\n') {
      newText = text.slice(0, lineStart) + fullLine + (after === '' ? '\n' : after)
      newCursor = lineStart + fullLine.length + 1
    } else {
      newText = text.slice(0, lineStart) + fullLine + after
      newCursor = lineStart + fullLine.length
    }

    if (!viewDate) return
    setPastText(newText)
    fireBloomIfNewLine(viewDate, newText)
    setPastCursorPos(newCursor)
    clearTimeout(pastSaveTimer.current)
    const dateSnapshot = viewDate
    pastSaveTimer.current = setTimeout(() => {
      saveDay(dateSnapshot, newText)
      setDataVersion(v => v + 1)
    }, 400)

    requestAnimationFrame(() => {
      if (pastTextareaRef.current) {
        pastTextareaRef.current.selectionStart = newCursor
        pastTextareaRef.current.selectionEnd = newCursor
        pastTextareaRef.current.focus()
      }
    })
  }, [pastSuggestion, pastText, viewDate])

  const handleDayClick = useCallback((date: string) => {
    const today = todayKey()
    setViewDate(prev => {
      if (date === today) return null
      if (prev === date) return null
      return date
    })
    setCursorPos(0)
    setPastCursorPos(0)
  }, [])

  const handleTouchStart = (e: React.TouchEvent) => {
    clearTimeout(swipeTimer.current)
    // If interrupted mid-animation, reset cleanly
    if (isSwipeAnimating) {
      setIsSwipeAnimating(false)
      setTitleStyle({})
      setNoteOpacity(1)
    }
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isSwipeAnimating) return
    const dx = e.touches[0].clientX - touchStartX.current
    const dy = e.touches[0].clientY - touchStartY.current
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      // Follow finger with no transition so it's instant
      setTitleStyle({ transform: `translateX(${dx * 0.45}px)` })
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current

    if (!isSwipeAnimating && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const navDir: -1 | 1 = dx > 0 ? -1 : 1
      const dir:    1 | -1 = dx > 0 ? 1  : -1  // visual direction of gesture

      // Boundary: can't go forward from today
      const current = viewDate ?? todayKey()
      const next = offsetDate(current, navDir)
      if (next > todayKey()) {
        // Snap back with transition from wherever drag ended
        setTitleStyle({ transform: 'translateX(0)', transition: 'transform 0.15s ease' })
        swipeTimer.current = setTimeout(() => setTitleStyle({}), 160)
        return
      }

      setIsSwipeAnimating(true)

      // EXIT: animate from current drag position (no reset to 0 → no jitter)
      setTitleStyle({
        transform: `translateX(${dir * 120}px)`,
        opacity: 0,
        transition: 'transform 0.08s ease, opacity 0.07s ease',
      })
      setNoteOpacity(0)

      clearTimeout(swipeTimer.current)
      swipeTimer.current = setTimeout(() => {
        // Advance date & instantly place incoming title off the opposite side
        navigateDay(navDir)
        setTitleStyle({ transform: `translateX(${-dir * 50}px)`, opacity: 0 })

        // Two RAF hops so the browser paints the "from" state before transitioning
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTitleStyle({
              transform: 'translateX(0)',
              opacity: 1,
              transition: 'transform 0.08s ease, opacity 0.08s ease',
            })
            setNoteOpacity(1)
          })
        })

        swipeTimer.current = setTimeout(() => {
          setTitleStyle({})
          setIsSwipeAnimating(false)
        }, 100)
      }, 90)
    } else {
      // Snap back smoothly from wherever drag ended
      setTitleStyle({ transform: 'translateX(0)', transition: 'transform 0.15s ease' })
      swipeTimer.current = setTimeout(() => setTitleStyle({}), 160)
    }
  }

  const isViewingPast = viewDate !== null
  const titleText = isViewingPast ? formatDisplayDate(viewDate!) : 'Today'

  return (
    <div className="app">
      <div ref={heatmapRef}>
        <Heatmap
          onDayClick={handleDayClick}
          selectedDate={viewDate}
          dataVersion={dataVersion}
          filterVolume={filterVolumeMap}
          accentHex={accentHex}
          bloom={bloom}
        />
      </div>

      <div
        className="content"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="title-row" style={titleStyle}>
          <h1 className={`title${isViewingPast ? ' past' : ''}`}>{titleText}</h1>
          {isViewingPast ? (
            <button className="jump-today" onPointerDown={tap} onClick={() => { setViewDate(null); setCursorPos(0) }}>
              Today <ArrowRight size={13} strokeWidth={2} style={{ verticalAlign: 'middle', marginLeft: 2 }} />
            </button>
          ) : (
            <span className={`save-icon${saveStatus === 'saved' && hasExercises ? ' visible' : ''}`}>
              <Check size={18} strokeWidth={2.5} />
            </span>
          )}
        </div>

        <div style={{ opacity: noteOpacity, transition: 'opacity 0.08s ease', flex: 1, display: 'flex', flexDirection: 'column' }}>
          {isViewingPast ? (
            <Editor
              key={viewDate}
              value={pastText}
              onChange={handlePastChange}
              onCursorChange={setPastCursorPos}
              onTabConfirm={handlePastTabConfirm}
              suggestion={pastSuggestion}
              knownPast={knownPast}
              todayCounts={todayCounts}
              previousExercises={previousExercises}
              bodyweightKg={currentBw}
              bwIsSet={bwSet}
              reveal={reveal}
              textareaRef={pastTextareaRef}
              weightUnit={weightUnit}
            />
          ) : (
            <Editor
              value={todayText}
              onChange={handleChange}
              onCursorChange={setCursorPos}
              onTabConfirm={handleTabConfirm}
              suggestion={suggestion}
              knownPast={knownPast}
              todayCounts={todayCounts}
              previousExercises={previousExercises}
              bodyweightKg={currentBw}
              bwIsSet={bwSet}
              reveal={reveal}
              textareaRef={textareaRef}
              weightUnit={weightUnit}
            />
          )}
        </div>
      </div>
      <div className="bottom-bar">
        <div className="bottom-bar-main">
          <button
            onPointerDown={tap}
            className={`bottom-btn${sheetOpen ? ' active' : ''}`}
            onClick={() => { setSheetOpen(v => !v); setPresetSheetOpen(false); setSettingsOpen(false) }}
            aria-label="Exercises"
          >
            <Dumbbell size={23} strokeWidth={1.6} />
          </button>
          <button
            onPointerDown={tap}
            className={`bottom-btn${presetSheetOpen ? ' active' : ''}`}
            onClick={() => { setPresetSheetOpen(v => !v); setSheetOpen(false); setSettingsOpen(false) }}
            aria-label="Presets"
          >
            <Hash size={23} strokeWidth={1.6} />
          </button>
          <button
            className={`bottom-btn${reveal ? ' active' : ''}`}
            onPointerDown={e => { tap(e); e.preventDefault(); setReveal(true) }}
            onPointerUp={() => setReveal(false)}
            onPointerLeave={() => setReveal(false)}
            aria-label="Reveal exercise details"
          >
            <Eye size={23} strokeWidth={1.6} />
          </button>
        </div>
        <button
          onPointerDown={tap}
          className={`bottom-btn bottom-btn-settings${settingsOpen ? ' active' : ''}`}
          onClick={() => { setSettingsOpen(v => !v); setSheetOpen(false); setPresetSheetOpen(false) }}
          aria-label="Settings"
        >
          <Settings size={21} strokeWidth={1.6} />
        </button>
      </div>

      <ExerciseSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        aliases={aliases}
        onAliasesChange={setAliases}
        onFocusExercise={setFocusedExercise}
        dataVersion={dataVersion}
        onDataChange={() => setDataVersion(v => v + 1)}
        height={sheetHeight}
        onResize={handleSheetResize}
        onResizeEnd={handleSheetResizeEnd}
        weightUnit={weightUnit}
      />

      <PresetSheet
        open={presetSheetOpen}
        onClose={() => setPresetSheetOpen(false)}
        onFocusPreset={setFocusedPreset}
        dataVersion={dataVersion}
        onDataChange={() => setDataVersion(v => v + 1)}
        height={sheetHeight}
        onResize={handleSheetResize}
        onResizeEnd={handleSheetResizeEnd}
        weightUnit={weightUnit}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        height={sheetHeight}
        onResize={handleSheetResize}
        onResizeEnd={handleSheetResizeEnd}
        dataVersion={dataVersion}
        onDataChange={() => setDataVersion(v => v + 1)}
        onAccentChange={(key: AccentKey) => {
          const def = ACCENT_COLORS.find(c => c.key === key)!
          setAccentHex(def.hex)
        }}
        onWeightUnitChange={(unit: WeightUnit) => {
          setDefaultWeightUnit(unit)
          setWeightUnit(unit)
          setDataVersion(v => v + 1)
        }}
      />
    </div>
  )
}
