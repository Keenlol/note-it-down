import { useEffect, useRef } from 'react'
import { parseLine } from '../utils/parser'

export interface Suggestion {
  suffix: string
  lineIndex: number
}

interface Props {
  value: string
  onChange: (text: string) => void
  onCursorChange: (pos: number) => void
  onTabConfirm: () => void
  suggestion: Suggestion | null
  readOnly?: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

function renderOverlay(text: string, suggestion: Suggestion | null): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []

  lines.forEach((line, i) => {
    if (i > 0) nodes.push('\n')

    const { exercise } = parseLine(line)
    if (exercise) {
      nodes.push(
        <span key={i}>
          {exercise.name}{' '}
          <span className="num">{exercise.weight}</span>
          {' '}
          <span className="num">{exercise.repsXsets}</span>
        </span>
      )
    } else {
      nodes.push(<span key={i}>{line}</span>)
    }

    if (suggestion?.lineIndex === i) {
      nodes.push(
        <span key={`g${i}`} className="ghost">
          {suggestion.suffix}
        </span>
      )
    }
  })

  return nodes
}

export function Editor({ value, onChange, onCursorChange, onTabConfirm, suggestion, readOnly, textareaRef }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

  // Auto-resize textarea to content
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }, [value, textareaRef])

  const reportCursor = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    onCursorChange(e.currentTarget.selectionStart)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      if (suggestion) onTabConfirm()
    }
  }

  return (
    <div className="editor-wrap">
      <div ref={overlayRef} className="editor-overlay" aria-hidden="true">
        {renderOverlay(value, suggestion)}
        {/* trailing space keeps overlay height in sync with empty last line */}
        {value.endsWith('\n') || value === '' ? '​' : ''}
      </div>
      <textarea
        ref={textareaRef}
        className={`editor-textarea${readOnly ? ' read-only' : ''}`}
        value={value}
        onChange={e => {
          onChange(e.target.value)
          onCursorChange(e.target.selectionStart)
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={reportCursor}
        onMouseUp={reportCursor}
        onSelect={reportCursor}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        placeholder="BenchPress 12kg 10x4&#10;Squat 60kg 8x3&#10;notes go here too"
      />
    </div>
  )
}
