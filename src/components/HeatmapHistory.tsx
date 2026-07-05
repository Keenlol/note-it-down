import { useEffect, useRef, useState } from 'react'
import { Heatmap, WEEKS } from './Heatmap'

interface Props {
  open: boolean
  onClose: () => void
  onSelectDate: (date: string) => void  // tap a cell → jump editor there and close
  selectedDate: string | null
  dataVersion: number
  accentHex: string
  setCount: number                       // number of stacked 21-week sets to render
}

// Full-screen stacked history: one heatmap "set" per 21-week window going back in
// time (newest on top). Slides down + fades in on open; swipe up (from the top of
// the scroll) or tap a date to dismiss.
export function HeatmapHistory({ open, onClose, onSelectDate, selectedDate, dataVersion, accentHex, setCount }: Props) {
  const [render, setRender] = useState(open)
  const [shown, setShown] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const startY = useRef(0)
  const startX = useRef(0)

  // Mount, then flip `shown` a frame later so the entrance transition runs.
  // On close, drop `shown` to play the exit, then unmount after it finishes.
  useEffect(() => {
    if (open) {
      setRender(true)
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
    const t = setTimeout(() => setRender(false), 300)
    return () => clearTimeout(t)
  }, [open])

  if (!render) return null

  const handleTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY
    startX.current = e.touches[0].clientX
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    const dy = e.changedTouches[0].clientY - startY.current
    const dx = e.changedTouches[0].clientX - startX.current
    const atTop = (scrollRef.current?.scrollTop ?? 0) <= 0
    // Upward flick while already at the top of the list → dismiss.
    if (atTop && dy < -50 && Math.abs(dy) > Math.abs(dx) * 1.3) onClose()
  }

  const handleSelect = (date: string) => {
    onSelectDate(date)
    onClose()
  }

  return (
    <div
      ref={scrollRef}
      className={`heatmap-history${shown ? ' in' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="heatmap-history-inner">
        {Array.from({ length: setCount }, (_, i) => (
          <div key={i} className="heatmap-history-set" style={{ transitionDelay: `${i * 45}ms` }}>
            <Heatmap
              onDayClick={handleSelect}
              selectedDate={selectedDate}
              dataVersion={dataVersion}
              accentHex={accentHex}
              bloom={null}
              weekOffset={i * WEEKS}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
