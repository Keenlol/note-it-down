import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { buildPresetCatalog } from '../utils/presets'
import { tap } from '../utils/tap'
import { SheetHandle } from './SheetHandle'
import { Sticker } from './Sticker'

export interface PresetPick {
  line: number | null   // the day's header, or null while it has none
  onDay: string[]       // preset keys already on the viewed day
}

interface Props {
  target: PresetPick | null
  onPick: (name: string) => void
  onClose: () => void
  dataVersion: number
  height?: number
  onResize: (height: number) => void
  onResizeEnd: () => void
}

/**
 * Proper mode's preset selector: pick the day's preset, or name a new one. Most recent
 * first, since a split usually comes round in order; presets already on the
 * day sink to the end.
 */
export function PresetPickSheet({
  target, onPick, onClose, dataVersion, height, onResize, onResizeEnd,
}: Props) {
  const open = target !== null
  const [query, setQuery] = useState('')

  // Hold the last target so the content doesn't empty out during the slide-down.
  const lastTarget = useRef<PresetPick | null>(null)
  if (target) lastTarget.current = target
  const shown = target ?? lastTarget.current

  useEffect(() => { if (!open) setQuery('') }, [open])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const catalog = useMemo(() => buildPresetCatalog('recent'), [dataVersion])

  const typed = query.trim().replace(/^#+\s*/, '')
  const entries = useMemo(() => {
    const q = typed.toLowerCase()
    const onDay = new Set(shown?.onDay)
    return catalog
      .filter(e => !q || e.displayName.toLowerCase().includes(q) || e.norm.includes(q))
      .sort((a, b) => Number(onDay.has(a.norm)) - Number(onDay.has(b.norm)))
  }, [catalog, typed, shown])

  const offerNew = typed !== '' && !catalog.some(e =>
    e.norm === typed.toLowerCase() || e.displayName.toLowerCase() === typed.toLowerCase())

  return (
    <div className={`exercise-sheet${open ? ' open' : ''}`} style={height !== undefined ? { height: `${height}px` } : undefined}>
      <SheetHandle onClose={onClose} onResize={onResize} onResizeEnd={onResizeEnd} />

      <div className="sheet-header">
        <div className="sheet-title-row">
          <span className="sheet-title"><Sticker name="tag" className="sheet-title-icon lit" />Preset</span>
        </div>

        <div className="sheet-search">
          <Search size={15} strokeWidth={2} />
          <input
            className="search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search or name a new one…"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
          />
          {query && (
            <button className="search-clear" onPointerDown={tap} onClick={() => setQuery('')} aria-label="Clear search">
              <X size={15} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>

      <div className="exercise-list">
        {entries.length === 0 && !offerNew && (
          <p className="exercise-empty">
            {typed ? `No matches for “${typed}”.` : 'No presets yet — type a name.'}
          </p>
        )}
        {offerNew && (
          <div className="exercise-item-wrap" onPointerDown={tap} onClick={() => onPick(typed)}>
            <div className="exercise-item">
              <div className="ex-row-left">
                <Plus size={14} strokeWidth={2.25} className="swap-new-icon" />
                <span className="ex-name swap-name">#{typed}</span>
              </div>
              <div className="ex-row-right"><span className="swap-new-label">new</span></div>
            </div>
          </div>
        )}
        {entries.map(entry => {
          const onDay = shown?.onDay.includes(entry.norm)
          return (
            <div key={entry.norm} className="exercise-item-wrap" onPointerDown={tap} onClick={() => onPick(entry.displayName)}>
              <div className="exercise-item">
                <div className="ex-row-left">
                  <span className={`ex-name${onDay ? '' : ' swap-name'}`}>#{entry.displayName}</span>
                </div>
                <div className="ex-row-right">
                  <span className="ex-last">
                    {entry.exercises.length} exercise{entry.exercises.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
