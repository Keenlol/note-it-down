import { useMemo } from 'react'
import { dateToKey, loadDay, todayKey } from '../utils/storage'
import { totalVolume } from '../utils/parser'

interface Cell {
  date: string | null
  volume: number
  isToday: boolean
  isFuture: boolean
}

interface Props {
  onDayClick: (date: string) => void
  selectedDate: string | null
  dataVersion: number   // increments on every save, forcing the memo to re-run
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKS = 21

function cellColor(cell: Cell, maxVolume: number): string {
  if (cell.isFuture || cell.date === null) return 'transparent'

  const ratio = maxVolume > 0 ? Math.min(cell.volume / maxVolume, 1) : 0

  if (cell.isToday) {
    // 30% opacity baseline (even with 0 volume), scales to 100% at max volume
    const opacity = 0.3 + ratio * 0.7
    return `rgba(249, 115, 22, ${opacity.toFixed(2)})`
  }

  if (cell.volume === 0) return '#1e1e1e'

  // Non-empty cells: minimum 20% lightness so any workout is clearly visible
  // over the empty #1e1e1e (~12%). Scales to ~67% at max volume.
  const lightness = Math.round(20 + ratio * 47)
  return `hsl(0, 0%, ${lightness}%)`
}

export function Heatmap({ onDayClick, selectedDate, dataVersion }: Props) {
  const { weeks, monthLabels, maxVolume } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = todayKey()

    // Start from Sunday of (WEEKS-1) weeks ago
    const start = new Date(today)
    start.setDate(today.getDate() - (WEEKS - 1) * 7 - today.getDay())

    const cols: Cell[][] = []
    const labels: { col: number; label: string }[] = []
    let lastMonth = -1

    for (let w = 0; w < WEEKS; w++) {
      const col: Cell[] = []
      for (let d = 0; d < 7; d++) {
        const date = new Date(start)
        date.setDate(start.getDate() + w * 7 + d)
        const dateStr = dateToKey(date)
        const isFuture = date > today
        const isToday = dateStr === todayStr

        const isFirstOfMonth = date.getDate() === 1
        const isFirstWeek = w === 0 && d === 0
        if (!isFuture && (isFirstOfMonth || isFirstWeek) && date.getMonth() !== lastMonth) {
          labels.push({ col: w, label: MONTHS[date.getMonth()] })
          lastMonth = date.getMonth()
        }

        const dayData = isFuture ? null : loadDay(dateStr)
        col.push({
          date: isFuture ? null : dateStr,
          volume: dayData ? totalVolume(dayData.rawText) : 0,
          isToday,
          isFuture,
        })
      }
      cols.push(col)
    }

    // Find max volume across all cells (used for relative scaling)
    let max = 0
    for (const col of cols) {
      for (const cell of col) {
        if (cell.volume > max) max = cell.volume
      }
    }

    return { weeks: cols, monthLabels: labels, maxVolume: max }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion])

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-grid">
        {weeks.map((col, w) => (
          <div key={w} className="heatmap-col">
            {col.map((cell, d) => (
              <div
                key={d}
                className={`heatmap-cell${cell.date === selectedDate ? ' selected' : ''}`}
                style={{ background: cellColor(cell, maxVolume) }}
                onClick={() => cell.date && onDayClick(cell.date)}
                title={cell.date ?? undefined}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-months">
        {monthLabels.map(({ col, label }) => (
          <span key={`${col}-${label}`} style={{ gridColumn: col + 1 }} className="month-label">
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}
