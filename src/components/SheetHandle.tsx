import { useRef } from 'react'
import { tap } from '../utils/tap'

interface Props {
  onClose: () => void
  onResize: (height: number) => void   // called with the proposed sheet height during a drag
  onResizeEnd: () => void              // called once a drag finishes (persist the size)
}

// Movement under this many px counts as a tap (→ close) rather than a resize drag.
const DRAG_THRESHOLD = 4

/**
 * The grab handle at the top of a bottom sheet. Dragging it vertically resizes
 * the sheet (handled by the parent via onResize); a plain tap closes the sheet.
 */
export function SheetHandle({ onClose, onResize, onResizeEnd }: Props) {
  const startY  = useRef(0)
  const startH  = useRef(0)
  const moved   = useRef(false)
  const dragging = useRef(false)

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    tap(e)
    const sheet = e.currentTarget.closest('.exercise-sheet') as HTMLElement | null
    if (!sheet) return
    startY.current = e.clientY
    startH.current = sheet.getBoundingClientRect().height
    moved.current = false
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    const dy = startY.current - e.clientY   // drag up → positive → taller
    if (!moved.current && Math.abs(dy) > DRAG_THRESHOLD) moved.current = true
    if (moved.current) onResize(startH.current + dy)
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    dragging.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* already released */ }
    if (moved.current) onResizeEnd()
    else onClose()
  }

  return (
    <div
      className="sheet-handle-wrap"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="sheet-handle" />
    </div>
  )
}
