import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ArrowRight } from 'lucide-react'
import { Heatmap } from './components/Heatmap'
import { Editor, type Suggestion } from './components/Editor'
import { dateToKey, getAllDayKeys, loadDay, saveDay, todayKey } from './utils/storage'
import { normalizeName, parseLine, type ParsedLine } from './utils/parser'

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

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pastSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
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
    }, 400)
  }, [])

  const handlePastChange = useCallback((text: string) => {
    if (!viewDate) return
    setPastText(text)
    clearTimeout(pastSaveTimer.current)
    const dateSnapshot = viewDate
    pastSaveTimer.current = setTimeout(() => {
      saveDay(dateSnapshot, text)
    }, 400)
  }, [viewDate])

  const suggestion = useMemo<Suggestion | null>(() => {
    if (viewDate !== null) return null
    return getSuggestion(todayText, cursorPos, pastDays)
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
    return getSuggestion(pastText, pastCursorPos, dayBeforeParsed)
  }, [pastText, pastCursorPos, dayBeforeParsed, viewDate])

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
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      navigateDay(dx > 0 ? -1 : 1)
    }
  }

  const isViewingPast = viewDate !== null
  const titleText = isViewingPast ? formatDisplayDate(viewDate!) : 'Today'

  return (
    <div className="app">
      <Heatmap onDayClick={handleDayClick} selectedDate={viewDate} />

      <div
        className="content"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="title-row">
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
            textareaRef={textareaRef}
          />
        )}
      </div>
    </div>
  )
}
