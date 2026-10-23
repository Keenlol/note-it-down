import { useMemo, useRef, useState, useEffect } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { buildCatalog, lastLinesBefore } from '../utils/exercises'
import { presetExerciseNames } from '../utils/presets'
import { parseLine, normalizeName } from '../utils/parser'
import { tap } from '../utils/tap'
import { SheetHandle } from './SheetHandle'
import { Sticker } from './Sticker'

export interface SwapTarget {
  mode: 'swap' | 'add'       // replace the line's exercise, or add one to a block
  line: number               // swap: the line in the viewed day's note; add: the preset's header (-1 = none)
  name: string               // swap: the exercise as written on that line
  norm: string               // swap: its canonical key — left out of the list
  preset: { norm: string; name: string } | null  // the block the line sits in
  beforeDate: string         // numbers come from days strictly before this
  onDay: string[]            // canonical names already on the viewed day
}

interface Props {
  target: SwapTarget | null
  onPick: (name: string, lastLine: string | undefined) => void
  onClose: () => void
  aliases: Record<string, string>
  dataVersion: number
  height?: number
  onResize: (height: number) => void
  onResizeEnd: () => void
}

/** "Dumbell curl 10 12 3" → "10 12 3": what follows the name, as written. */
function numbersOf(line: string): string {
  const starts = parseLine(line).highlights.map(h => h.start)   // not in line order
  return starts.length > 0 ? line.slice(Math.min(...starts)).trim() : ''
}

/**
 * The exercise sheet as a picker: one tap on a row swaps it in (or, adding,
 * puts it in) and closes. When adding, a search that matches no exercise
 * offers itself as a new one.
 * Exercises from the same preset come first, since a swap is usually for
 * something that does the same job. No sort, merge, menus or history here —
 * each row shows the numbers the swap will bring with it instead.
 */
export function SwapSheet({
  target, onPick, onClose, aliases, dataVersion, height, onResize, onResizeEnd,
}: Props) {
  const open = target !== null
  const [query, setQuery] = useState('')

  // Hold the last target so the content doesn't empty out during the slide-down.
  const lastTarget = useRef<SwapTarget | null>(null)
  if (target) lastTarget.current = target
  const shown = target ?? lastTarget.current

  useEffect(() => { if (!open) setQuery('') }, [open])

  const catalog = useMemo(
    () => buildCatalog(aliases, 'count'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aliases, dataVersion],
  )

  const lastLines = useMemo(
    () => (shown ? lastLinesBefore(shown.beforeDate, aliases) : new Map<string, string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown?.beforeDate, aliases, dataVersion],
  )

  const presetNames = useMemo(
    () => (shown?.preset ? presetExerciseNames(shown.preset.norm, aliases) : new Set<string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown?.preset?.norm, aliases, dataVersion],
  )

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = catalog.filter(e =>
      e.norm !== shown?.norm &&
      (!q || e.displayName.toLowerCase().includes(q) || e.nicknames.some(n => n.includes(q))),
    )
    // Already on the day: still pickable, but not what a swap is usually after.
    const onDay = new Set(shown?.onDay)
    pool.sort((a, b) => Number(onDay.has(a.norm)) - Number(onDay.has(b.norm)))
    const inPreset = pool.filter(e => presetNames.has(e.norm))
    const rest = pool.filter(e => !presetNames.has(e.norm))
    if (inPreset.length === 0) return [{ label: null, entries: rest }]
    return [
      { label: `In #${shown!.preset!.name}`, entries: inPreset },
      { label: 'Everything else', entries: rest },
    ].filter(g => g.entries.length > 0)
  }, [catalog, query, presetNames, shown])

  const adding = shown?.mode === 'add'
  // Adding is the one place a name gets typed: a search that names nothing
  // logged yet can become a new exercise.
  const typed = query.trim()
  const offerNew = adding && typed !== '' && !catalog.some(e =>
    e.norm === normalizeName(typed) || e.nicknames.includes(normalizeName(typed)))
  const empty = groups.every(g => g.entries.length === 0) && !offerNew

  return (
    <div className={`exercise-sheet${open ? ' open' : ''}`} style={height !== undefined ? { height: `${height}px` } : undefined}>
      <SheetHandle onClose={onClose} onResize={onResize} onResizeEnd={onResizeEnd} />

      <div className="sheet-header">
        <div className="sheet-title-row">
          <span className="sheet-title"><Sticker name="dumbbell" className="sheet-title-icon lit" />{adding ? 'Add' : 'Swap'}</span>
          {shown && !adding && <span className="swap-from">for {shown.name}</span>}
          {shown && adding && shown.preset && <span className="swap-from">to #{shown.preset.name}</span>}
        </div>

        <div className="sheet-search">
          <Search size={15} strokeWidth={2} />
          <input
            className="search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={adding ? 'Search or name a new one…' : 'Search exercises…'}
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
        {empty && (
          <p className="exercise-empty">
            {query.trim() ? `No matches for “${query.trim()}”.` : adding ? 'Nothing logged yet — type a name.' : 'Nothing else logged yet.'}
          </p>
        )}
        {offerNew && (
          <div className="exercise-item-wrap" onPointerDown={tap} onClick={() => onPick(typed, undefined)}>
            <div className="exercise-item">
              <div className="ex-row-left">
                <Plus size={14} strokeWidth={2.25} className="swap-new-icon" />
                <span className="ex-name swap-name">{typed}</span>
              </div>
              <div className="ex-row-right"><span className="swap-new-label">new</span></div>
            </div>
          </div>
        )}
        {groups.map(group => (
          <div key={group.label ?? 'all'} className="swap-group">
            {group.label && <p className="swap-group-label">{group.label}</p>}
            {group.entries.map(entry => {
              const last = lastLines.get(entry.norm)
              const onDay = shown?.onDay.includes(entry.norm)
              return (
                <div
                  key={entry.norm}
                  className="exercise-item-wrap"
                  onPointerDown={tap}
                  onClick={() => onPick(entry.displayName, last)}
                >
                  <div className="exercise-item">
                    <div className="ex-row-left">
                      <span className={`ex-name${onDay ? '' : ' swap-name'}`}>{entry.displayName}</span>
                    </div>
                    <div className="ex-row-right">
                      {last && <span className="swap-numbers">{numbersOf(last)}</span>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
