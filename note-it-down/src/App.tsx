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

  // Only suggest when cursor is at end of current line
  const allLines = currentText.split('\n')
  if (currentLine.length !== allLines[lineIndex]?.length) return null

  const refLines = refText.split('\n')

  if (currentLine === '') {
    // Empty line: suggest the reference line at the same index
    const refLine = refLines[lineIndex]
    if (refLine?.trim()) return { suffix: refLine, lineIndex }
    return null
  }

  const lower = currentLine.toLowerCase()

  // Prefer same-index line match
  if (lineIndex < refLines.length) {
    const refLine = refLines[lineIndex]
    if (refLine.toLowerCase().startsWith(lower) && refLine.length > currentLine.length) {
      return { suffix: refLine.slice(currentLine.length), lineIndex }
    }
  }

  // Fall back to any line in the reference
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

export function App() {
  const [todayText, setTodayText] = useState(() => loadDay(todayKey())?.rawText ?? '')
  const [viewDate, setViewDate] = useState<string | null>(null) // null = today
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(() =>
    loadDay(todayKey()) ? 'saved' : 'idle'
  )
  const [cursorPos, setCursorPos] = useState(0)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pastTextareaRef = useRef<HTMLTextAreaElement>(null)

  // Load yesterday's text for suggestions (only changes at midnight, so memoize by day)
  const referenceText = useMemo(() => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    return loadDay(dateToKey(yesterday))?.rawText ?? ''
  }, [])

  // Load saved text for today on mount (handles re-opens during same day)
  useEffect(() => {
    const saved = loadDay(todayKey())
    if (saved) setTodayText(saved.rawText)
  }, [])

  const handleChange = useCallback((text: string) => {
    setTodayText(text)
    setSaveStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveDay(todayKey(), text)
      setSaveStatus('saved')
    }, 400)
  }, [])

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

  const pastText = useMemo(() => {
    if (!viewDate) return ''
    return loadDay(viewDate)?.rawText ?? ''
  }, [viewDate])

  const isViewingPast = viewDate !== null

  const handleDayClick = (date: string) => {
    setViewDate(prev => (prev === date ? null : date))
  }

  const titleText = isViewingPast ? formatDisplayDate(viewDate!) : 'Today'

  return (
    <div className="app">
      <Heatmap onDayClick={handleDayClick} selectedDate={viewDate} />

      <div className="content">
        <div className="title-row">
          <h1 className={`title${isViewingPast ? ' past' : ''}`}>{titleText}</h1>
          {!isViewingPast && (
            <span className={`save-icon${saveStatus === 'saved' ? ' visible' : ''}`}>✓</span>
          )}
        </div>

        {isViewingPast ? (
          <Editor
            key={viewDate}
            value={pastText}
            onChange={() => {}}
            onCursorChange={() => {}}
            onTabConfirm={() => {}}
            suggestion={null}
            readOnly
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
