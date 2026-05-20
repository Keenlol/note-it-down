import { useMemo } from 'react'
import { dateToKey, todayKey } from '../utils/storage'
import { getDayVolume } from '../utils/exercises'
import { tap } from '../utils/tap'

interface Cell {
  date: string | null
  volume: number
  isToday: boolean
  isFuture: boolean
}

interface Props {
  onDayClick: (date: string) => void
  selectedDate: string | null
  dataVersion: number                 // increments on every save, forcing the memo to re-run
  filterVolume?: Map<string, number>  // per-day volume for a specific exercise; triggers accent mode
  accentHex: string                   // current accent color hex, e.g. "#f97316"
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKS = 21

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r},${g},${b}`
}

function cellColor(cell: Cell, maxVolume: number, filtered: boolean, accentRgb: string): string {
  if (cell.isFuture || cell.date === null) return 'transparent'

  const ratio = maxVolume > 0 ? Math.min(cell.volume / maxVolume, 1) : 0

  if (filtered) {
    if (cell.volume === 0) return '#1e1e1e'
    const opacity = (0.2 + ratio * 0.8).toFixed(2)
    return `rgba(${accentRgb},${opacity})`
  }

  if (cell.isToday) {
    const opacity = (0.3 + ratio * 0.7).toFixed(2)
    return `rgba(${accentRgb},${opacity})`
  }

  if (cell.volume === 0) return '#1e1e1e'

  const lightness = Math.round(20 + ratio * 47)
  return `hsl(0, 0%, ${lightness}%)`
}

export function Heatmap({ onDayClick, selectedDate, dataVersion, filterVolume, accentHex }: Props) {
  const accentRgb = useMemo(() => hexToRgb(accentHex), [accentHex])

  const { weeks, monthLabels, maxVolume } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = todayKey()

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

        const volume = filterVolume
          ? (filterVolume.get(dateStr) ?? 0)
          : (isFuture ? 0 : getDayVolume(dateStr))

        col.push({ date: isFuture ? null : dateStr, volume, isToday, isFuture })
      }
      cols.push(col)
    }

    let max = 0
    for (const col of cols) for (const cell of col) if (cell.volume > max) max = cell.volume

    return { weeks: cols, monthLabels: labels, maxVolume: max }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataVersion, filterVolume])

  const filtered = !!filterVolume

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-grid">
        {weeks.map((col, w) => (
          <div key={w} className="heatmap-col">
            {col.map((cell, d) => (
              <div
                key={d}
                onPointerDown={tap}
                className={`heatmap-cell${((cell.date !== null && cell.date === selectedDate) || (cell.isToday && selectedDate === null)) ? ' selected' : ''}`}
                style={{ background: cellColor(cell, maxVolume, filtered, accentRgb) }}
                onClick={() => { if (cell.date) onDayClick(cell.date) }}
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
