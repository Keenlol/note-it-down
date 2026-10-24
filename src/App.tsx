import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, Lock, Redo2, Undo2 } from 'lucide-react'
import { Heatmap } from './components/Heatmap'
import { WEEKS, weekOffsetForDate, historySetCount } from './utils/heatmapWindow'
import { HeatmapHistory } from './components/HeatmapHistory'
import { Editor, type Suggestion } from './components/Editor'
import { ExerciseSheet } from './components/ExerciseSheet'
import { PresetSheet } from './components/PresetSheet'
import { BodyweightSheet } from './components/BodyweightSheet'
import { SettingsSheet } from './components/SettingsSheet'
import { Encouragement } from './components/Encouragement'
import { DayNav, type PresetNav } from './components/DayNav'
import { SwapSheet, type SwapTarget } from './components/SwapSheet'
import { Sticker } from './components/Sticker'
import { dateToKey, getAllDayKeys, loadDay, saveDay, todayKey } from './utils/storage'
import { normalizeName, parseLine, countExercises, type ParsedLine, type Exercise } from './utils/parser'
import { loadAliases } from './utils/aliases'
import { exerciseVolumePerDay, type ExerciseEntry } from './utils/exercises'
import { presetVolumePerDay, presetBlocks, presetDayIndex } from './utils/presets'
import { getBwOn, setBwEntry, isBwSet, loadBwHistory } from './utils/bodyweight'
import { press, release, cancelPress, tap } from './utils/tap'
import { remember, undo, redo, canUndo, canRedo, newEditGroup } from './utils/history'
import { getSavedAccent, applyAccent, ACCENT_COLORS, type AccentKey, getSavedWeightUnit, type WeightUnit, getSavedShowDownTrend, getSavedShowQuote, getSavedLockPast, getSavedSheetHeight, saveSheetHeight, getSavedHeatRound, applyHeatRound } from './utils/settings'
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
    for (const block of presetBlocks(lines)) {
      const exercises = block.exerciseIndices.map(idx => lines[idx].raw)
      // Newest occurrence wins; only keep presets that actually have exercises
      if (!presets.has(block.norm) && exercises.length > 0) {
        presets.set(block.norm, { rawContent: block.rawContent, exercises })
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

// Gap left above the panel when snapped to the top of the screen (also the
// hard cap on how tall a drag can grow it).
const SHEET_TOP_GAP = 12

// Bottom-bar buttons squash while held and pop as the finger lifts, so the pop
// isn't spent under the finger.
const pressPop = { onPointerDown: press, onPointerUp: release, onPointerCancel: cancelPress, onPointerLeave: cancelPress }

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
  // The eye: the note's formatted view, where values are held and dragged
  // instead of typed. Read-only while it's on, so the keyboard goes away.
  const [reveal, setReveal] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [presetSheetOpen, setPresetSheetOpen] = useState(false)
  const [bwSheetOpen, setBwSheetOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The line being swapped; the swap picker is open while this is set.
  const [swapTarget, setSwapTarget] = useState<SwapTarget | null>(null)
  const swapOpen = swapTarget !== null
  // The picker sizes itself to open just under the note, so the line being
  // swapped stays in view; it never touches the other sheets' saved height.
  const [swapHeight, setSwapHeight] = useState<number | undefined>(undefined)
  const swapHeightRef = useRef<number | undefined>(undefined)
  const [historyMounted, setHistoryMounted] = useState(false)
  const [accentHex, setAccentHex] = useState(() => {
    const key = getSavedAccent()
    return ACCENT_COLORS.find(c => c.key === key)?.hex ?? '#f97316'
  })
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(() => getSavedWeightUnit())
  const [showDownTrend, setShowDownTrend] = useState<boolean>(() => getSavedShowDownTrend())
  const [showQuote, setShowQuote] = useState<boolean>(() => getSavedShowQuote())
  // Past days read-only — the note, the eye's drags, the grip and swap alike.
  const [lockPast, setLockPast] = useState<boolean>(() => getSavedLockPast())
  const [focusedExercise, setFocusedExercise] = useState<string | null>(null)
  const [focusedPreset, setFocusedPreset] = useState<string | null>(null)
  // Preset the ‹ › stepper is following. Pinned on a step so it survives a
  // landing day that holds several presets; any cursor move hands it back.
  const [navPreset, setNavPreset] = useState<string | null>(null)
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
  // Panel snapping: true only while animating to a snap point (enables a height
  // transition; off during a live drag so the panel follows the finger).
  const [sheetSnapping, setSheetSnapping] = useState(false)
  // Which snap point the panel is parked at (ref, not state — only read in
  // callbacks/effects, and we don't want changing it to retrigger the note effect).
  const activeSnap = useRef<'top' | 'heatmap' | 'note' | null>(null)
  const snapAnimTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const prevViewDate = useRef<string | null>(null)
  // Set when the day changes while parked at the note snap — consumed (with
  // animation) once the new day's text has actually landed in the textarea.
  const daySnapArmed = useRef(false)

  function clampSheetHeight(px: number): number {
    const vh = window.visualViewport?.height ?? window.innerHeight
    return Math.round(Math.max(220, Math.min(px, vh - SHEET_TOP_GAP)))
  }

  const handleSheetResize = (px: number) => {
    manualSheetHeight.current = true
    if (snapAnimTimer.current) { clearTimeout(snapAnimTimer.current); snapAnimTimer.current = undefined }
    setSheetSnapping(false)              // follow the finger with no transition
    const clamped = clampSheetHeight(px)
    latestSheetHeight.current = clamped
    setSheetHeight(clamped)
  }

  // Animate the panel to a height (used for snapping); persists the result.
  const animateSheetTo = (height: number) => {
    if (snapAnimTimer.current) clearTimeout(snapAnimTimer.current)
    const clamped = clampSheetHeight(height)
    setSheetSnapping(true)
    latestSheetHeight.current = clamped
    setSheetHeight(clamped)
    saveSheetHeight(clamped)
    snapAnimTimer.current = setTimeout(() => setSheetSnapping(false), 320)
  }

  const closeAllSheets = () => {
    setSheetOpen(false); setPresetSheetOpen(false); setBwSheetOpen(false); setSettingsOpen(false)
    setSwapTarget(null)
  }

  // Bottom of the note's last *non-empty* line — trailing blank lines are ignored
  // so the note snap point doesn't sit below the visible content. Reads the live
  // textarea value (never stale React state).
  const measureNoteBottom = (): number => {
    const heatmapBottom = heatmapRef.current?.getBoundingClientRect().bottom ?? SHEET_TOP_GAP
    const ta = (viewDate ? pastTextareaRef : textareaRef).current
    if (!ta) return heatmapBottom
    const lines = ta.value.split('\n')
    let trailingEmpty = 0
    for (let i = lines.length - 1; i >= 0 && lines[i].trim() === ''; i--) trailingEmpty++
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 0
    return ta.getBoundingClientRect().bottom - trailingEmpty * lh
  }

  // On release, snap to the nearest of four points (measured by the panel's top
  // edge): screen top, under the heatmap, under the note's last line, or — lowest
  // — closed.
  const handleSheetResizeEnd = () => {
    const vh = window.visualViewport?.height ?? window.innerHeight
    const sheetTop = vh - (latestSheetHeight.current ?? 0)
    const heatmapBottom = heatmapRef.current?.getBoundingClientRect().bottom ?? SHEET_TOP_GAP
    const noteBottom = measureNoteBottom()

    const points: { snap: 'top' | 'heatmap' | 'note' | 'close'; topY: number }[] = [
      { snap: 'top',     topY: SHEET_TOP_GAP },
      { snap: 'heatmap', topY: heatmapBottom },
      { snap: 'note',    topY: noteBottom },
      { snap: 'close',   topY: vh },
    ]
    let best = points[0]
    for (const p of points) {
      if (Math.abs(p.topY - sheetTop) < Math.abs(best.topY - sheetTop)) best = p
    }

    const targetHeight = clampSheetHeight(vh - best.topY)
    if (best.snap === 'close' || targetHeight <= 220) {
      activeSnap.current = null
      // Restore the last good height (hidden behind the slide-down) so reopening
      // doesn't show the tiny height the drag ended at.
      const restore = getSavedSheetHeight()
      if (restore !== undefined) { latestSheetHeight.current = restore; setSheetHeight(restore) }
      closeAllSheets()
      return
    }
    activeSnap.current = best.snap
    animateSheetTo(targetHeight)
  }

  const filterVolumeMap = useMemo(
    () => {
      // Bodyweight sheet open → highlight every day that has a weight entry (uniform accent).
      if (bwSheetOpen) {
        const map = new Map<string, number>()
        for (const e of loadBwHistory()) map.set(e.date, 1)
        return map
      }
      if (focusedExercise) return exerciseVolumePerDay(focusedExercise, aliases)
      if (focusedPreset) return presetVolumePerDay(focusedPreset)
      return undefined
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bwSheetOpen, focusedExercise, focusedPreset, aliases, dataVersion, bwVersion],
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

  // While parked at the note snap point, follow the note's last line as it
  // changes — animate on a day switch, track instantly while typing.
  // The day switch arms an animated re-snap; it's applied once the new day's
  // text has actually landed in the textarea (pastText loads a render later, so
  // the first fire would otherwise measure stale content / cancel the animation).
  useEffect(() => {
    if (prevViewDate.current !== viewDate) {
      prevViewDate.current = viewDate
      daySnapArmed.current = true
    }
    if (activeSnap.current !== 'note' || !(sheetOpen || presetSheetOpen || bwSheetOpen || settingsOpen || swapOpen)) {
      daySnapArmed.current = false
      return
    }
    const id = requestAnimationFrame(() => {
      const ta = (viewDate ? pastTextareaRef : textareaRef).current
      if (!ta) return
      const vh = window.visualViewport?.height ?? window.innerHeight
      if (daySnapArmed.current) {
        // Wait until the textarea holds the new day's saved text before animating.
        const expected = viewDate ? (loadDay(viewDate)?.rawText ?? '') : todayText
        if (ta.value !== expected) return
        daySnapArmed.current = false
        animateSheetTo(vh - measureNoteBottom())
      } else {
        if (snapAnimTimer.current) { clearTimeout(snapAnimTimer.current); snapAnimTimer.current = undefined }
        setSheetSnapping(false)
        const target = clampSheetHeight(vh - measureNoteBottom())
        latestSheetHeight.current = target
        setSheetHeight(target)
      }
    })
    return () => cancelAnimationFrame(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate, todayText, pastText, sheetOpen, presetSheetOpen, bwSheetOpen, settingsOpen, swapOpen])

  useEffect(() => {
    const saved = loadDay(todayKey())
    if (saved) setTodayText(saved.rawText)
  }, [])


  // Apply saved accent color, weight unit and heatmap rounding on first render
  useEffect(() => {
    applyAccent(accentHex)
    applyHeatRound(getSavedHeatRound())
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

  // The text on screen, for callbacks that outlive a render.
  const todayTextRef = useRef(todayText)
  todayTextRef.current = todayText
  const pastTextRef = useRef(pastText)
  pastTextRef.current = pastText
  // Bumped whenever a day's history changes, so the undo / redo icons follow.
  const [, setHistoryTick] = useState(0)

  // Writes, unremembered: the edit paths below remember first, undo and redo don't.
  const writeToday = useCallback((text: string) => {
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

  const writePast = useCallback((text: string) => {
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

  // Every edit to a day's note comes through one of these two, so it lands in
  // that day's history. `group` ties a run of changes into one undo step; none
  // means typing.
  const handleChange = useCallback((text: string, group?: string) => {
    remember(todayKey(), todayTextRef.current, text, group)
    setHistoryTick(t => t + 1)
    writeToday(text)
  }, [writeToday])

  const handlePastChange = useCallback((text: string, group?: string) => {
    if (!viewDate) return
    remember(viewDate, pastTextRef.current, text, group)
    setHistoryTick(t => t + 1)
    writePast(text)
  }, [viewDate, writePast])

  // ── Undo / redo ──
  // A locked past day has nothing to undo: it can't be edited to begin with.
  const historyDay = viewDate ?? todayKey()
  const historyOn = !(viewDate && lockPast)
  const showUndo = historyOn && canUndo(historyDay)
  const showRedo = historyOn && canRedo(historyDay)

  const stepHistory = useCallback((dir: 'undo' | 'redo') => {
    if (viewDate && lockPast) return
    const day = viewDate ?? todayKey()
    const current = viewDate ? pastTextRef.current : todayTextRef.current
    const text = dir === 'undo' ? undo(day, current) : redo(day, current)
    if (text === null) return
    setHistoryTick(t => t + 1)
    if (viewDate) writePast(text); else writeToday(text)
  }, [viewDate, lockPast, writePast, writeToday])

  // ⌘Z / ⇧⌘Z (Ctrl on other systems, and Ctrl+Y) — in the note too, standing
  // in for the browser's own undo, which can't see the edits made around it.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'z') { e.preventDefault(); stepHistory(e.shiftKey ? 'redo' : 'undo') }
      else if (key === 'y' && e.ctrlKey) { e.preventDefault(); stepHistory('redo') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [stepHistory])

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
    if (!viewDate || lockPast) return null
    return getHashPresetSuggestion(pastText, pastCursorPos, daysBeforeView)
        ?? getSuggestion(pastText, pastCursorPos, daysBeforeView)
  }, [pastText, pastCursorPos, daysBeforeView, viewDate, lockPast])

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

    handleChange(newText, newEditGroup())
    setCursorPos(newCursor)

    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newCursor
        textareaRef.current.selectionEnd = newCursor
        textareaRef.current.focus()
      }
    })
  }, [suggestion, todayText, handleChange])

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
    handlePastChange(newText, newEditGroup())
    setPastCursorPos(newCursor)

    requestAnimationFrame(() => {
      if (pastTextareaRef.current) {
        pastTextareaRef.current.selectionStart = newCursor
        pastTextareaRef.current.selectionEnd = newCursor
        pastTextareaRef.current.focus()
      }
    })
  }, [pastSuggestion, pastText, viewDate, handlePastChange])

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

  // Jump to a specific date from a history-list entry. The sheet stays open so
  // the user can keep browsing history.
  const goToDate = useCallback((date: string) => {
    setViewDate(date === todayKey() ? null : date)
    setCursorPos(0)
    setPastCursorPos(0)
  }, [])

  // ── Preset stepper ──────────────────────────────────────────────────────
  // The viewed day's preset is the block the cursor sits in (the first one
  // when the cursor is above every header), unless a step pinned one.
  const presetDays = useMemo(() => presetDayIndex(), [dataVersion])

  const viewedPreset = useMemo(() => {
    const text = viewDate ? pastText : todayText
    const blocks = presetBlocks(text.split('\n').map(l => parseLine(l)))
      .filter(b => b.exerciseIndices.length > 0)
    if (blocks.length === 0) return null
    const pinned = blocks.find(b => b.norm === navPreset)
    if (pinned) return pinned
    const cursor = viewDate ? pastCursorPos : cursorPos
    const cursorLine = text.slice(0, cursor).split('\n').length - 1
    return blocks.findLast(b => b.headerIndex <= cursorLine) ?? blocks[0]
  }, [viewDate, pastText, todayText, pastCursorPos, cursorPos, navPreset])

  const todayPresets = useMemo(
    () => new Set(presetBlocks(todayText.split('\n').map(l => parseLine(l)))
      .filter(b => b.exerciseIndices.length > 0)
      .map(b => b.norm)),
    [todayText],
  )

  // Hidden until there is somewhere to step to — a preset trained only on the
  // viewed day has no neighbours, and neither does a header still being typed.
  const presetNav = useMemo((): PresetNav | null => {
    if (!viewedPreset) return null
    const today = todayKey()
    const current = viewDate ?? today
    // Stored copies of today and the viewed day can lag the live text by the
    // save debounce, so those two are decided from what is on screen.
    const dates = new Set(presetDays.get(viewedPreset.norm) ?? [])
    dates.delete(today)
    if (todayPresets.has(viewedPreset.norm)) dates.add(today)
    dates.add(current)
    if (dates.size < 2) return null
    const sorted = [...dates].sort()
    const i = sorted.indexOf(current)
    return { name: viewedPreset.rawContent, prev: sorted[i - 1] ?? null, next: sorted[i + 1] ?? null }
  }, [viewedPreset, presetDays, todayPresets, viewDate])

  const stepPreset = useCallback((date: string) => {
    if (viewedPreset) setNavPreset(viewedPreset.norm)
    goToDate(date)
  }, [viewedPreset, goToDate])

  const handleCursorChange = useCallback((pos: number) => {
    setCursorPos(pos)
    setNavPreset(null)
  }, [])

  const handlePastCursorChange = useCallback((pos: number) => {
    setPastCursorPos(pos)
    setNavPreset(null)
  }, [])

  // ── Swap ────────────────────────────────────────────────────────────────
  // A swap belongs to the day it was opened on.
  useEffect(() => { setSwapTarget(null) }, [viewDate])
  // The eye belongs to the day it was turned on for: moving to another day
  // turns it off, so a new day always opens as a note to type into.
  useEffect(() => { setReveal(false) }, [viewDate])

  const handleSwapLine = useCallback((line: number) => {
    const lines = (viewDate ? pastText : todayText).split('\n')
    const ex = parseLine(lines[line]).exercise
    if (!ex) return
    const norm = normalizeName(ex.name)
    const block = presetBlocks(lines.map(l => parseLine(l))).find(b => b.exerciseIndices.includes(line))
    // The picker needs the room the keyboard is taking.
    ;(viewDate ? pastTextareaRef : textareaRef).current?.blur()
    setSheetOpen(false); setPresetSheetOpen(false); setBwSheetOpen(false); setSettingsOpen(false)
    const vh = window.innerHeight
    swapHeightRef.current = clampSheetHeight(Math.max(vh * 0.45, vh - measureNoteBottom() - 12))
    setSwapHeight(swapHeightRef.current)
    setSwapTarget({
      line,
      name: ex.name,
      norm: aliases[norm] ?? norm,
      preset: block ? { norm: block.norm, name: block.rawContent } : null,
      beforeDate: viewDate ?? todayKey(),
      onDay: lines.flatMap(l => {
        const n = parseLine(l).exercise?.name
        return n ? [aliases[normalizeName(n)] ?? normalizeName(n)] : []
      }),
    })
  }, [viewDate, pastText, todayText, aliases])

  // The picked exercise comes in as it was last written, numbers and all. One
  // never logged before this day keeps the swapped line's numbers instead.
  const handleSwapPick = useCallback((entry: ExerciseEntry, lastLine: string | undefined) => {
    if (!swapTarget) return
    const lines = (viewDate ? pastText : todayText).split('\n')
    const old = lines[swapTarget.line] ?? ''
    const names = parseLine(old).nameRanges
    if (lastLine) {
      lines[swapTarget.line] = old.match(/^\s*/)![0] + lastLine
    } else if (names.length > 0) {
      lines[swapTarget.line] =
        old.slice(0, names[0].start) + entry.displayName + old.slice(names[names.length - 1].end)
    }
    const text = lines.join('\n')
    if (viewDate) handlePastChange(text, newEditGroup()); else handleChange(text, newEditGroup())
    setSwapTarget(null)
  }, [swapTarget, viewDate, pastText, todayText, handlePastChange, handleChange])

  // Inline heatmap pages back a whole 21-week "set" once the viewed day falls
  // outside the today-anchored window; returns to set 0 for recent days / today.
  const heatmapWeekOffset = useMemo(() => weekOffsetForDate(viewDate), [viewDate])

  // How many stacked sets the swipe-down history overlay needs to reach the
  // oldest logged day.
  const historySets = useMemo(
    () => historySetCount(getAllDayKeys()[0] ?? null),
    [dataVersion],
  )

  // ── Stacked-history reveal gesture ──────────────────────────────────────
  // Driven by one number, the pull: how far the stack has been drawn down, in
  // px. Set i starts tucked behind set 0 and travels with the pull until it
  // reaches its own slot (i × pitch), so the set still moving is always the
  // stack's bottom edge, and that edge stays under the finger 1:1 — sets unroll
  // one after another rather than fanning out faster than the hand. Past the
  // last slot the stack stretches with resistance. On release a spring takes
  // over, carrying the finger's speed: it opens fully once the pull passed
  // HISTORY_COMMIT (or on a downward flick), otherwise it tucks back.
  // Everything is written straight to the sets' styles, so dragging never
  // re-renders the cell tree. A pull DOWN that starts on the graph opens it;
  // a drag UP from the top of the open overlay retracts it.
  const HISTORY_COMMIT = 56     // px of pull past which release completes the action
  const HISTORY_FLICK = 0.35    // px/ms — a flick this fast decides on its own
  const HISTORY_STRETCH = 64    // px — the most the stack stretches past fully open
  const historyRef = useRef<HTMLDivElement>(null)
  const histDrag = useRef({
    mode: 'none' as 'none' | 'open' | 'close',
    active: false, startX: 0, startY: 0, base: 0,
    samples: [] as { t: number; y: number }[],
  })
  const histPull = useRef(0)
  const histGeom = useRef({ pitch: 0, total: 0 })   // measured once per mount
  const histSpring = useRef(0)
  const histSnapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const layoutHistory = (pull: number) => {
    histPull.current = pull
    const el = historyRef.current
    const sets = el?.firstElementChild?.children
    if (!el || !sets || sets.length < 2) return
    const g = histGeom.current
    if (!g.pitch) {
      g.pitch = (sets[1] as HTMLElement).offsetTop - (sets[0] as HTMLElement).offsetTop
      g.total = g.pitch * (sets.length - 1)
    }
    const { pitch, total } = g
    const over = Math.max(0, pull - total)
    const stretch = HISTORY_STRETCH * over / (over + 2 * HISTORY_STRETCH)
    for (let i = 1; i < sets.length; i++) {
      const slot = i * pitch
      const travel = Math.min(Math.max(pull, 0), slot) + stretch * i / (sets.length - 1)
      // how far set i has come out from under set i-1, 0..1
      const shown = Math.min(Math.max(pull / pitch - (i - 1), 0), 1)
      const s = sets[i] as HTMLElement
      s.style.transform = `translateY(${travel - slot}px) scale(${0.95 + 0.05 * shown})`
      s.style.setProperty('--shown', String(shown))
    }
    el.style.setProperty('--p', String(Math.min(Math.max(pull / pitch, 0), 1)))
  }

  // The overlay mounts mid-drag; lay it out at the pull the finger has reached.
  useLayoutEffect(() => {
    if (!historyMounted) return
    histGeom.current = { pitch: 0, total: 0 }
    layoutHistory(histPull.current)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyMounted])

  useEffect(() => () => cancelAnimationFrame(histSpring.current), [])

  // Spring to fully open or tucked away. Slightly underdamped on the way open,
  // so the stack lands with a small stretch and settles; critically damped on
  // the way back, so nothing pokes out above set 0.
  const springHistory = (to: 'open' | 'closed', velocity: number) => {
    cancelAnimationFrame(histSpring.current)
    const target = to === 'open' ? histGeom.current.total : 0
    const settle = () => {
      layoutHistory(target)
      if (to === 'closed') setHistoryMounted(false)
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { settle(); return }
    const K = 380, C = to === 'open' ? 24 : 39
    let x = histPull.current, v = velocity * 1000, last = performance.now()
    const step = (now: number) => {
      const dt = Math.min((now - last) / 1000, 1 / 30)
      last = now
      v += (-K * (x - target) - C * v) * dt
      x += v * dt
      if ((to === 'closed' && x <= 0.5) || (Math.abs(x - target) < 0.5 && Math.abs(v) < 12)) { settle(); return }
      layoutHistory(x)
      histSpring.current = requestAnimationFrame(step)
    }
    histSpring.current = requestAnimationFrame(step)
  }

  // Finger speed in px/ms over the last ~100 ms of the drag (positive = down).
  const trackHist = (y: number) => {
    const s = histDrag.current.samples
    const t = performance.now()
    s.push({ t, y })
    while (s.length > 2 && t - s[0].t > 100) s.shift()
  }
  const histVelocity = () => {
    const s = histDrag.current.samples
    if (s.length < 2) return 0
    const a = s[0], b = s[s.length - 1]
    return performance.now() - b.t > 80 ? 0 : (b.y - a.y) / Math.max(b.t - a.t, 1)
  }

  // Pull DOWN on the graph → reveal history. Only the graph starts it, so a
  // drag anywhere in the note (a line grip, a scroll) can never set it off.
  const handleRevealTouchStart = (e: React.TouchEvent) => {
    if (historyMounted || historySets <= 1) return       // nothing older to reveal
    if (window.scrollY > 0) return                       // the page scrolls first
    const t = e.touches[0]
    histDrag.current = { mode: 'open', active: false, startX: t.clientX, startY: t.clientY, base: 0, samples: [] }
  }
  const handleRevealTouchMove = (e: React.TouchEvent) => {
    const d = histDrag.current
    if (d.mode !== 'open') return
    const { clientX: x, clientY: y } = e.touches[0]
    if (!d.active) {
      const dy = y - d.startY, dx = x - d.startX
      if (dy > 6 && dy > Math.abs(dx) * 1.2) {
        d.active = true
        d.startY = y              // measure from here, so the stack starts under the finger
        closeAllSheets()
        histPull.current = 0
        setHistoryMounted(true)
      } else if (dy < -6 || Math.abs(dx) > 8) {
        d.mode = 'none'  // resolved as an up/side gesture — not our reveal
        return
      } else return
    }
    trackHist(y)
    layoutHistory(Math.max(0, y - d.startY))
  }
  const handleRevealTouchEnd = () => {
    const d = histDrag.current
    if (d.mode !== 'open' || !d.active) { d.mode = 'none'; return }
    const v = histVelocity()
    d.active = false; d.mode = 'none'
    const open = v > HISTORY_FLICK || (histPull.current > HISTORY_COMMIT && v > -HISTORY_FLICK)
    springHistory(open ? 'open' : 'closed', v)
  }

  // Drag UP from the top of the open overlay → retract history.
  const handleHistoryTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    histDrag.current = { mode: 'close', active: false, startX: t.clientX, startY: t.clientY, base: 0, samples: [] }
  }
  const handleHistoryTouchMove = (e: React.TouchEvent) => {
    const d = histDrag.current
    if (d.mode !== 'close') return
    const { clientX: x, clientY: y } = e.touches[0]
    if (!d.active) {
      const dy = y - d.startY, dx = x - d.startX
      const el = historyRef.current
      const atTop = (el?.scrollTop ?? 0) <= 0
      if (!(atTop && dy < -8 && Math.abs(dy) > Math.abs(dx) * 1.2)) return
      d.active = true
      d.startY = y
      cancelAnimationFrame(histSpring.current)
      // Retract from the lowest set on screen, not the bottom of a stack that
      // runs off it — sets below the fold tuck in out of sight, so the first
      // thing to move under the finger is something you can see.
      const { pitch, total } = histGeom.current
      const set0 = el?.firstElementChild?.firstElementChild as HTMLElement | null | undefined
      const r = set0?.getBoundingClientRect()
      const onScreen = r && pitch ? Math.ceil((window.innerHeight - r.bottom) / pitch) * pitch : total
      d.base = Math.min(histPull.current, total, Math.max(onScreen, pitch))
    }
    trackHist(y)
    layoutHistory(Math.max(0, d.base + y - d.startY))
  }
  const handleHistoryTouchEnd = () => {
    const d = histDrag.current
    if (d.mode !== 'close' || !d.active) { d.mode = 'none'; return }
    const v = histVelocity()
    d.active = false; d.mode = 'none'
    const close = v < -HISTORY_FLICK || (d.base - histPull.current > HISTORY_COMMIT && v < HISTORY_FLICK)
    springHistory(close ? 'closed' : 'open', v)
  }

  // Tap a date in history → jump the editor there, then slide the tapped set up
  // into the top slot while the overlay cross-fades out. Because the inline
  // heatmap underneath has already switched to that same window, the tapped set
  // lands exactly on it and the handoff reads as a graceful replace (measured
  // grid-to-grid so it's correct even when the overlay is scrolled).
  const handleHistorySelect = useCallback((date: string) => {
    goToDate(date)
    const el = historyRef.current
    const inner = el?.firstElementChild as HTMLElement | null
    cancelAnimationFrame(histSpring.current)
    if (!el || !inner) { setHistoryMounted(false); return }

    const setIndex = weekOffsetForDate(date) / WEEKS
    const target = inner.children[setIndex] as HTMLElement | undefined
    const inlineGrid = heatmapRef.current?.querySelector('.heatmap-grid') as HTMLElement | null
    const targetGrid = target?.querySelector('.heatmap-grid') as HTMLElement | null
    const delta = targetGrid && inlineGrid
      ? targetGrid.getBoundingClientRect().top - inlineGrid.getBoundingClientRect().top
      : 0

    inner.style.transition = 'transform 0.34s cubic-bezier(0.22, 1, 0.36, 1)'
    inner.style.transform = `translateY(${-delta}px)`
    el.style.transition = 'opacity 0.34s ease'
    el.style.opacity = '0'
    clearTimeout(histSnapTimer.current)
    histSnapTimer.current = setTimeout(() => setHistoryMounted(false), 360)
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const showMessage = !isViewingPast && showQuote
  const showDayNav = presetNav !== null || isViewingPast

  return (
    <div className={`app${sheetSnapping ? ' sheet-snapping' : ''}`}>
      <div
        ref={heatmapRef}
        onTouchStart={handleRevealTouchStart}
        onTouchMove={handleRevealTouchMove}
        onTouchEnd={handleRevealTouchEnd}
        onTouchCancel={handleRevealTouchEnd}
      >
        <Heatmap
          onDayClick={handleDayClick}
          selectedDate={viewDate}
          dataVersion={dataVersion}
          filterVolume={filterVolumeMap}
          accentHex={accentHex}
          bloom={bloom}
          weekOffset={heatmapWeekOffset}
        />
      </div>

      <div
        className={`content${showDayNav && showMessage ? ' strip-tall' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="title-row" style={titleStyle}>
          <h1 className={`title${isViewingPast ? ' past' : ''}`}>{titleText}</h1>
          {isViewingPast && lockPast && (
            <span className="lock-icon" aria-label="Past days are locked">
              <Lock size={16} strokeWidth={2.25} />
            </span>
          )}
          {!isViewingPast && (
            <span className={`save-icon${saveStatus === 'saved' && hasExercises ? ' visible' : ''}`}>
              <Check size={18} strokeWidth={2.5} />
            </span>
          )}
          {/* Up once there is anything to step through. A press here keeps
              the note's focus, so the keyboard stays up mid-typing. */}
          {(showUndo || showRedo) && (
            <div className="history-btns">
              <button
                type="button"
                className="history-btn"
                disabled={!showUndo}
                onPointerDown={e => { e.preventDefault(); tap(e) }}
                onClick={() => stepHistory('undo')}
                aria-label="Undo"
              >
                <Undo2 size={17} strokeWidth={2.25} />
              </button>
              <button
                type="button"
                className="history-btn"
                disabled={!showRedo}
                onPointerDown={e => { e.preventDefault(); tap(e) }}
                onClick={() => stepHistory('redo')}
                aria-label="Redo"
              >
                <Redo2 size={17} strokeWidth={2.25} />
              </button>
            </div>
          )}
        </div>

        <div style={{ opacity: noteOpacity, transition: 'opacity 0.08s ease', flex: 1, display: 'flex', flexDirection: 'column' }}>
          {isViewingPast ? (
            <Editor
              key={viewDate}
              value={pastText}
              onChange={handlePastChange}
              onCursorChange={handlePastCursorChange}
              onSwapLine={handleSwapLine}
              swapLine={swapTarget?.line ?? null}
              onTabConfirm={handlePastTabConfirm}
              suggestion={pastSuggestion}
              readOnly={lockPast}
              knownPast={knownPast}
              todayCounts={todayCounts}
              previousExercises={previousExercises}
              bodyweightKg={currentBw}
              bwIsSet={bwSet}
              reveal={reveal}
              textareaRef={pastTextareaRef}
              weightUnit={weightUnit}
              showDownTrend={showDownTrend}
            />
          ) : (
            <Editor
              value={todayText}
              onChange={handleChange}
              onCursorChange={handleCursorChange}
              onSwapLine={handleSwapLine}
              swapLine={swapTarget?.line ?? null}
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
              showDownTrend={showDownTrend}
            />
          )}
        </div>
      </div>
      {/* Above the icons but a sibling of the bar, not a child: it has to sit
          below the sheets in the stack, and the bar sits above them. */}
      <div className="bottom-strip">
        {showMessage && <Encouragement canFinish={todayText.trim() !== ''} />}
        <DayNav
          preset={presetNav}
          showToday={isViewingPast}
          onPresetStep={stepPreset}
          onToday={() => { setViewDate(null); setCursorPos(0) }}
        />
      </div>

      <div className="bottom-bar">
        <div className="bottom-bar-row">
          <div className="bottom-bar-main">
            <button
              {...pressPop}
              className={`bottom-btn${bwSheetOpen ? ' active' : ''}`}
              onClick={() => { setBwSheetOpen(v => !v); setSheetOpen(false); setPresetSheetOpen(false); setSettingsOpen(false) ; setSwapTarget(null) }}
              aria-label="Bodyweight"
            >
              <Sticker name="scale" className="bottom-icon" />
            </button>
            <button
              {...pressPop}
              className={`bottom-btn${sheetOpen ? ' active' : ''}`}
              onClick={() => { setSheetOpen(v => !v); setPresetSheetOpen(false); setBwSheetOpen(false); setSettingsOpen(false) ; setSwapTarget(null) }}
              aria-label="Exercises"
            >
              <Sticker name="dumbbell" className="bottom-icon" />
            </button>
            <button
              {...pressPop}
              className={`bottom-btn${presetSheetOpen ? ' active' : ''}`}
              onClick={() => { setPresetSheetOpen(v => !v); setSheetOpen(false); setBwSheetOpen(false); setSettingsOpen(false) ; setSwapTarget(null) }}
              aria-label="Presets"
            >
              <Sticker name="tag" className="bottom-icon" />
            </button>
            <button
              {...pressPop}
              className={`bottom-btn${reveal ? ' active' : ''}`}
              onClick={() => {
                if (!reveal) (viewDate ? pastTextareaRef : textareaRef).current?.blur()
                setReveal(v => !v)
              }}
              aria-label="Reveal exercise details"
              aria-pressed={reveal}
            >
              <Sticker name="eyes" className="bottom-icon" />
            </button>
          </div>
          <button
            {...pressPop}
            className={`bottom-btn bottom-btn-settings${settingsOpen ? ' active' : ''}`}
            onClick={() => { setSettingsOpen(v => !v); setSheetOpen(false); setPresetSheetOpen(false); setBwSheetOpen(false) ; setSwapTarget(null) }}
            aria-label="Settings"
          >
            <Sticker name="gear" className="bottom-icon" />
          </button>
        </div>
      </div>

      {historyMounted && (
        <HeatmapHistory
          rootRef={historyRef}
          setCount={historySets}
          selectedDate={viewDate}
          dataVersion={dataVersion}
          accentHex={accentHex}
          onSelectDate={handleHistorySelect}
          onTouchStart={handleHistoryTouchStart}
          onTouchMove={handleHistoryTouchMove}
          onTouchEnd={handleHistoryTouchEnd}
        />
      )}

      <ExerciseSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        aliases={aliases}
        onAliasesChange={setAliases}
        onFocusExercise={setFocusedExercise}
        onSelectDate={goToDate}
        dataVersion={dataVersion}
        onDataChange={() => setDataVersion(v => v + 1)}
        height={sheetHeight}
        onResize={handleSheetResize}
        onResizeEnd={handleSheetResizeEnd}
        weightUnit={weightUnit}
        showDownTrend={showDownTrend}
      />

      <SwapSheet
        target={swapTarget}
        onPick={handleSwapPick}
        onClose={() => setSwapTarget(null)}
        aliases={aliases}
        dataVersion={dataVersion}
        height={swapHeight}
        onResize={px => { swapHeightRef.current = clampSheetHeight(px); setSwapHeight(swapHeightRef.current) }}
        onResizeEnd={() => { if ((swapHeightRef.current ?? 0) <= 240) setSwapTarget(null) }}
      />

      <PresetSheet
        open={presetSheetOpen}
        onClose={() => setPresetSheetOpen(false)}
        onFocusPreset={setFocusedPreset}
        onSelectDate={goToDate}
        dataVersion={dataVersion}
        onDataChange={() => setDataVersion(v => v + 1)}
        height={sheetHeight}
        onResize={handleSheetResize}
        onResizeEnd={handleSheetResizeEnd}
        weightUnit={weightUnit}
        showDownTrend={showDownTrend}
        aliases={aliases}
      />

      <BodyweightSheet
        open={bwSheetOpen}
        onClose={() => setBwSheetOpen(false)}
        onSelectDate={goToDate}
        dataVersion={dataVersion}
        bwVersion={bwVersion}
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
        onShowDownTrendChange={setShowDownTrend}
        onShowQuoteChange={setShowQuote}
        onLockPastChange={setLockPast}
        onWeightUnitChange={(unit: WeightUnit) => {
          setDefaultWeightUnit(unit)
          setWeightUnit(unit)
          setDataVersion(v => v + 1)
        }}
      />
    </div>
  )
}
