import { useEffect, useRef } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { parseLine, isKnownName, type ParsedLine } from '../utils/parser'

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
  knownPast: Set<string>
  todayCounts: Map<string, number>
  readOnly?: boolean
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

function renderLine(raw: string, parsed: ParsedLine, isUnknown: boolean): React.ReactNode[] {
  if (raw.length === 0) return []

  const cls: (string | null)[] = new Array(raw.length).fill(null)
  for (const r of parsed.highlights) {
    for (let i = r.start; i < r.end; i++) cls[i] = 'num'
  }
  if (parsed.exercise && isUnknown) {
    for (const r of parsed.nameRanges) {
      for (let i = r.start; i < r.end; i++) {
        if (cls[i] === null) cls[i] = 'unknown-name'
      }
    }
  }

  const out: React.ReactNode[] = []
  let segStart = 0
  for (let i = 1; i <= raw.length; i++) {
    if (i === raw.length || cls[i] !== cls[segStart]) {
      const text = raw.slice(segStart, i)
      const c = cls[segStart]
      out.push(
        c
          ? <span key={segStart} className={c}>{text}</span>
          : <span key={segStart}>{text}</span>
      )
      segStart = i
    }
  }
  return out
}

function renderOverlay(
  text: string,
  suggestion: Suggestion | null,
  knownPast: Set<string>,
  todayCounts: Map<string, number>,
): React.ReactNode[] {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []

  lines.forEach((line, i) => {
    if (i > 0) nodes.push('\n')
    const parsed = parseLine(line)
    const unknown = parsed.exercise
      ? !isKnownName(parsed.exercise.name, knownPast, todayCounts)
      : false
    nodes.push(<span key={`l${i}`}>{renderLine(line, parsed, unknown)}</span>)

    if (suggestion?.lineIndex === i) {
      nodes.push(
        <span key={`g${i}`} className="ghost">
          {suggestion.suffix}
          <CornerDownLeft size={12} strokeWidth={2} className="ghost-enter-icon" />
        </span>
      )
    }
  })

  return nodes
}

export function Editor({ value, onChange, onCursorChange, onTabConfirm, suggestion, knownPast, todayCounts, readOnly, textareaRef }: Props) {
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
    if (e.key === 'Enter' && suggestion) {
      e.preventDefault()
      onTabConfirm()
    }
  }

  return (
    <div className="editor-wrap">
      <div ref={overlayRef} className="editor-overlay" aria-hidden="true">
        {renderOverlay(value, suggestion, knownPast, todayCounts)}
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
        placeholder=""
      />
    </div>
  )
}
