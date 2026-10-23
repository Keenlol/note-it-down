import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'
import { tap } from '../utils/tap'

export interface PresetNav {
  name: string         // header text as written on the viewed day
  prev: string | null  // nearest older day with this preset
  next: string | null  // nearest newer day (today included)
}

interface Props {
  preset: PresetNav | null
  showToday: boolean
  onPresetStep: (date: string) => void
  onToday: () => void
}

/**
 * The row above the daily message: ‹ preset › steps between the days that share
 * the viewed day's preset, Today → returns from a past day. Both are centred as
 * one group, so whichever is alone sits where the message does.
 */
export function DayNav({ preset, showToday, onPresetStep, onToday }: Props) {
  if (!preset && !showToday) return null

  return (
    <div className="day-nav">
      {preset && (
        <div className="preset-nav">
          <button
            type="button"
            className="preset-nav-arrow"
            onPointerDown={tap}
            onClick={() => preset.prev && onPresetStep(preset.prev)}
            disabled={!preset.prev}
            aria-label="Previous day with this preset"
          >
            <ChevronLeft size={16} strokeWidth={2.5} />
          </button>
          <span className="preset-nav-name">
            <span className="preset-nav-hash">#</span>{preset.name}
          </span>
          <button
            type="button"
            className="preset-nav-arrow"
            onPointerDown={tap}
            onClick={() => preset.next && onPresetStep(preset.next)}
            disabled={!preset.next}
            aria-label="Next day with this preset"
          >
            <ChevronRight size={16} strokeWidth={2.5} />
          </button>
        </div>
      )}
      {showToday && (
        <button type="button" className="today-btn" onPointerDown={tap} onClick={onToday}>
          Today <ArrowRight size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}
