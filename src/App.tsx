import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ArrowRight } from 'lucide-react'
import { Heatmap } from './components/Heatmap'
import { Editor, type Suggestion } from './components/Editor'
import { dateToKey, getAllDayKeys, loadDay, saveDay, todayKey } from './utils/storage'
import { normalizeName, parseLine, type ParsedLine, type Exercise } from './utils/parser'

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

// Note-triggered preset: when cursor is on a non-exercise line that matches a past note,
// suggest ALL exercises from the latest past day containing that note.
function getPresetSuggestion(
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

  // Only trigger on non-exercise, non-empty lines
  if (parseLine(currentLine).exercise !== null) return null
  if (currentLine.trim() === '') return null

  const noteText = currentLine.toLowerCase().trim()

  // Names already typed today (excluding current line)
  const todayNames = new Set<string>()
  allLines.forEach((line, i) => {
    if (i === lineIndex) return
    const p = parseLine(line)
    if (p.exercise?.name) todayNames.add(normalizeName(p.exercise.name))
  })

  // Find the latest past day containing exactly this note text
  for (const day of pastDays) { // newest first
    const hasNote = day.parsedLines.some(
      p => p.exercise === null && p.raw.toLowerCase().trim() === noteText
    )
    if (!hasNote) continue

    const exercises = day.parsedLines
      .filter(p => {
        if (!p.exercise) return false
        return !todayNames.has(normalizeName(p.exercise.name))
      })
      .map(p => p.raw)

    if (exercises.length === 0) continue

    return {
      suffix: '\n' + exercises.join('\n'),
      lineIndex,
      presetLines: exercises,
    }
  }

  return null
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

  // Names from past days only — always considered known.
  const knownPast = useMemo(() => {
    const set = new Set<string>()
    for (const day of pastDays) {
      for (const p of day.parsedLines) {
        if (p.exercise && p.exercise.name) set.add(normalizeName(p.exercise.name))
      }
    }
    return set
  }, [pastDays])

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
    const saved = loadDay(todayKey())
    if (saved) setTodayText(saved.rawText)
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
    setSaveStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveDay(todayKey(), text)
      setSaveStatus('saved')
      setDataVersion(v => v + 1)
    }, 400)
  }, [])

  const handlePastChange = useCallback((text: string) => {
    if (!viewDate) return
    setPastText(text)
    clearTimeout(pastSaveTimer.current)
    const dateSnapshot = viewDate
    pastSaveTimer.current = setTimeout(() => {
      saveDay(dateSnapshot, text)
      setDataVersion(v => v + 1)
    }, 400)
  }, [viewDate])

  const suggestion = useMemo<Suggestion | null>(() => {
    if (viewDate !== null) return null
    return getPresetSuggestion(todayText, cursorPos, pastDays)
        ?? getSuggestion(todayText, cursorPos, pastDays)
  }, [todayText, cursorPos, pastDays, viewDate])

  // For past-day editing: suggest only from the day immediately before viewDate
  const dayBeforeParsed = useMemo<ParsedDay[]>(() => {
    if (!viewDate) return []
    const dayBefore = offsetDate(viewDate, -1)
    const rawText = loadDay(dayBefore)?.rawText ?? ''
    if (!rawText) return []
    return [{ date: dayBefore, rawText, parsedLines: rawText.split('\n').map(parseLine) }]
  }, [viewDate])

  const pastSuggestion = useMemo<Suggestion | null>(() => {
    if (!viewDate) return null
    return getPresetSuggestion(pastText, pastCursorPos, dayBeforeParsed)
        ?? getSuggestion(pastText, pastCursorPos, dayBeforeParsed)
  }, [pastText, pastCursorPos, dayBeforeParsed, viewDate])

  // Most recent prior occurrence of each exercise, for trend indicators.
  // For today: search all past days. For a past day: search only days before it.
  const previousExercises = useMemo<Map<string, Exercise>>(() => {
    const map = new Map<string, Exercise>()
    const sources = viewDate
      ? pastDays.filter(d => d.date < viewDate)  // days strictly before viewed date
      : pastDays                                  // all past days (for today)
    for (const day of sources) {  // newest-first → first hit = most recent
      for (const p of day.parsedLines) {
        if (p.exercise) {
          const key = normalizeName(p.exercise.name)
          if (!map.has(key)) map.set(key, p.exercise)
        }
      }
    }
    return map
  }, [pastDays, viewDate])

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
      <Heatmap onDayClick={handleDayClick} selectedDate={viewDate} dataVersion={dataVersion} />

      <div
        className="content"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="title-row" style={titleStyle}>
          <h1 className={`title${isViewingPast ? ' past' : ''}`}>{titleText}</h1>
          {isViewingPast ? (
            <button className="jump-today" onClick={() => { setViewDate(null); setCursorPos(0) }}>
              Today <ArrowRight size={13} strokeWidth={2} style={{ verticalAlign: 'middle', marginLeft: 2 }} />
            </button>
          ) : (
            <span className={`save-icon${saveStatus === 'saved' ? ' visible' : ''}`}>
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
              textareaRef={pastTextareaRef}
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
              textareaRef={textareaRef}
            />
          )}
        </div>
      </div>
    </div>
  )
}
