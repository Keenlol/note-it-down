import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Heatmap } from './components/Heatmap'
import { Editor, type Suggestion } from './components/Editor'
import { dateToKey, loadDay, saveDay, todayKey } from './utils/storage'

type SaveStatus = 'idle' | 'saving' | 'saved'

function getSuggestion(
  currentText: string,
  cursorPos: number,
  refText: string,
): Suggestion | null {
  if (!refText.trim()) return null

  const textBefore = currentText.slice(0, cursorPos)
  const linesBeforeCursor = textBefore.split('\n')
  const lineIndex = linesBeforeCursor.length - 1
  const currentLine = linesBeforeCursor[lineIndex]

  const allLines = currentText.split('\n')
  if (currentLine.length !== allLines[lineIndex]?.length) return null

  const refLines = refText.split('\n')

  if (currentLine === '') {
    const refLine = refLines[lineIndex]
    if (refLine?.trim()) return { suffix: refLine, lineIndex }
    return null
  }

  const lower = currentLine.toLowerCase()

  if (lineIndex < refLines.length) {
    const refLine = refLines[lineIndex]
    if (refLine.toLowerCase().startsWith(lower) && refLine.length > currentLine.length) {
      return { suffix: refLine.slice(currentLine.length), lineIndex }
    }
  }

  for (const refLine of refLines) {
    if (refLine.toLowerCase().startsWith(lower) && refLine.length > currentLine.length) {
      return { suffix: refLine.slice(currentLine.length), lineIndex }
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

export function App() {
  const [todayText, setTodayText] = useState(() => loadDay(todayKey())?.rawText ?? '')
  const [viewDate, setViewDate] = useState<string | null>(null)
  const [pastText, setPastText] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(() =>
    loadDay(todayKey()) ? 'saved' : 'idle'
  )
  const [cursorPos, setCursorPos] = useState(0)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pastSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pastTextareaRef = useRef<HTMLTextAreaElement>(null)
  const touchStartX = useRef(0)
  const touchStartY = useRef(0)

  const referenceText = useMemo(() => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    return loadDay(dateToKey(yesterday))?.rawText ?? ''
  }, [])

  useEffect(() => {
    const saved = loadDay(todayKey())
    if (saved) setTodayText(saved.rawText)
  }, [])

  // Load past day text whenever viewDate changes
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
  }, [viewDate])

  // Arrow key navigation (skip when focus is inside textarea)
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
    return getSuggestion(todayText, cursorPos, referenceText)
  }, [todayText, cursorPos, referenceText, viewDate])

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

  const handleDayClick = useCallback((date: string) => {
    const today = todayKey()
    setViewDate(prev => {
      if (date === today) return null        // clicking today → go to today
      if (prev === date) return null         // clicking selected past → deselect → today
      return date
    })
    setCursorPos(0)
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
              Today →
            </button>
          ) : (
            <span className={`save-icon${saveStatus === 'saved' ? ' visible' : ''}`}>✓</span>
          )}
        </div>

        {isViewingPast ? (
          <Editor
            key={viewDate}
            value={pastText}
            onChange={handlePastChange}
            onCursorChange={() => {}}
            onTabConfirm={() => {}}
            suggestion={null}
            textareaRef={pastTextareaRef}
          />
        ) : (
          <Editor
            value={todayText}
            onChange={handleChange}
            onCursorChange={setCursorPos}
            onTabConfirm={handleTabConfirm}
            suggestion={suggestion}
            textareaRef={textareaRef}
          />
        )}
      </div>
    </div>
  )
}
