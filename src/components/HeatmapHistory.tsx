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
// is a finger-driven accordion: each set collapses behind set 0 at --p:0 and fans
// down to its natural position at --p:1. All gesture state (the --p variable,
// snap transition) is driven imperatively from App via `rootRef` so dragging the
// finger never re-renders this heavy cell tree.
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
