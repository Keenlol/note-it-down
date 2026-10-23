import { Heatmap } from './Heatmap'
import { WEEKS } from '../utils/heatmapWindow'

interface Props {
  rootRef: React.Ref<HTMLDivElement>
  setCount: number                       // number of stacked 21-week sets to render
  selectedDate: string | null
  dataVersion: number
  accentHex: string
  onSelectDate: (date: string) => void   // tap a cell → jump editor there and close
  onTouchStart: (e: React.TouchEvent) => void
  onTouchMove: (e: React.TouchEvent) => void
  onTouchEnd: (e: React.TouchEvent) => void
}

// Presentational stacked history: one heatmap "set" per 21-week window going back
// in time, set 0 (most recent) pinned on top over the inline heatmap. The reveal
// is finger-driven: every set starts tucked behind set 0 and App unrolls them one
// after another as the pull grows. All gesture state (each set's transform, the
// backdrop's --p, the release spring) is driven imperatively from App via
// `rootRef` so dragging the finger never re-renders this heavy cell tree.
export function HeatmapHistory({
  rootRef, setCount, selectedDate, dataVersion, accentHex,
  onSelectDate, onTouchStart, onTouchMove, onTouchEnd,
}: Props) {
  return (
    <div
      ref={rootRef}
      className="heatmap-history"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div className="heatmap-history-inner">
        {Array.from({ length: setCount }, (_, i) => (
          <div
            key={i}
            className="heatmap-history-set"
            // deeper sets sit behind shallower ones so they emerge from *under* set 0
            style={{ ['--i' as string]: i, zIndex: setCount - i }}
          >
            <Heatmap
              onDayClick={onSelectDate}
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
