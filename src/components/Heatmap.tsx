import { useMemo } from 'react'
import { dateToKey, loadDay, todayKey } from '../utils/storage'
import { countExercises } from '../utils/parser'

interface Cell {
  date: string | null
  count: number
  isToday: boolean
  isFuture: boolean
}

interface Props {
  onDayClick: (date: string) => void
  selectedDate: string | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKS = 16

function cellColor(cell: Cell): string {
  if (cell.isFuture || cell.date === null) return 'transparent'
  if (cell.isToday) return '#f97316'
  if (cell.count === 0) return '#1e1e1e'
  if (cell.count <= 2) return '#3a3a3a'
  if (cell.count <= 4) return '#636363'
  return '#a0a0a0'
}

export function Heatmap({ onDayClick, selectedDate }: Props) {
  const { weeks, monthLabels } = useMemo(() => {
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

        // Label when this week contains the 1st of a new month, or on first week
        const isFirstOfMonth = date.getDate() === 1
        const isFirstWeek = w === 0 && d === 0
        if (!isFuture && (isFirstOfMonth || isFirstWeek) && date.getMonth() !== lastMonth) {
          labels.push({ col: w, label: MONTHS[date.getMonth()] })
          lastMonth = date.getMonth()
        }

        const dayData = isFuture ? null : loadDay(dateStr)
        col.push({
          date: isFuture ? null : dateStr,
          count: dayData ? countExercises(dayData.rawText) : 0,
          isToday,
          isFuture,
        })
      }
      cols.push(col)
    }

    return { weeks: cols, monthLabels: labels }
  }, [])

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-grid">
        {weeks.map((col, w) => (
          <div key={w} className="heatmap-col">
            {col.map((cell, d) => (
              <div
                key={d}
                className={`heatmap-cell${cell.date === selectedDate ? ' selected' : ''}`}
                style={{ background: cellColor(cell) }}
                onClick={() => cell.date && !cell.isToday && onDayClick(cell.date)}
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
