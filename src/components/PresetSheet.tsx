import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import {
  buildPresetCatalog, setPresetNickname,
  deletePresetLabelOnly, deletePresetWithExercises,
  getPresetHistory, getPresetExerciseSeries,
  type PresetHistoryEntry, type PresetExercisePoint,
} from '../utils/presets'
import { type WeightUnit, formatWeightDiff } from '../utils/settings'
import { todayKey } from '../utils/storage'
import { windowStart, dayIndex } from '../utils/window'
import { tap } from '../utils/tap'
import { MetricGraph } from './MetricGraph'
import { ExerciseHistoryList } from './ExerciseHistoryList'
import { SheetHandle } from './SheetHandle'
import { Sticker } from './Sticker'
import { TrendItem, POS_COLOR, NEG_COLOR } from './TrendItem'

interface Props {
  open: boolean
  onClose: () => void
  onFocusPreset: (norm: string | null) => void
  onSelectDate: (date: string) => void
  dataVersion: number
  onDataChange: () => void
  height?: number
  onResize: (height: number) => void
  onResizeEnd: () => void
  weightUnit?: WeightUnit
  showDownTrend?: boolean
  aliases?: Record<string, string>
}

const KG_PER_LB = 0.453592

function toUnit(kg: number, unit: WeightUnit): number {
  return unit === 'lbs' ? kg / KG_PER_LB : kg
}

/** Full total-volume number with thousands separators (history rows + headline). */
function fmtFull(kg: number, unit: WeightUnit): string {
  return Math.round(toUnit(kg, unit)).toLocaleString()
}

/** Plain number for the weight pills and headline — the unit is set apart, smaller. */
function fmtNum(v: number): string {
  const r = Math.round(v * 10) / 10
  return r % 1 === 0 ? `${Math.round(r)}` : `${r}`
}

/**
 * Reps or sets for the latest session, on the line under the weight. These
 * move far less than the weight, so they get no graph of their own — a figure
 * that changed since the session before takes the trend badge's colour and
 * arrow, inline; one that held stays accent like any other number.
 */
function Figure({ value, prev, suffix = '', showDown }: {
  value: number
  prev: number | undefined
  suffix?: string
  showDown: boolean
}) {
  const diff = prev === undefined ? 0 : value - prev
  const dir = diff > 0 ? 'up' : diff < 0 && showDown ? 'down' : null
  const Icon = dir === 'up' ? ArrowUp : ArrowDown
  return (
    <span className="preset-ex-fig" style={dir ? { color: dir === 'up' ? POS_COLOR : NEG_COLOR } : undefined}>
      {value}{suffix}
      {dir && <Icon size={11} strokeWidth={2.5} />}
    </span>
  )
}

type DeleteMode = 'label-only' | 'with-exercises'

export function PresetSheet({ open, onClose, onFocusPreset, onSelectDate, dataVersion, onDataChange, height, onResize, onResizeEnd, weightUnit = 'kg', showDownTrend = true, aliases = {} }: Props) {
  const [activeNorm, setActiveNorm] = useState<string | null>(null)
  // Which exercise row has its history expanded (accordion — one at a time).
  const [expandedEx, setExpandedEx] = useState<string | null>(null)
  // Title-row ⋮ menu (rename / delete), portalled to body.
  const [menuOpen, setMenuOpen]         = useState(false)
  const [menuClosing, setMenuClosing]   = useState(false)
  const closeTimerRef                   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [menuTop, setMenuTop]           = useState(0)
  const [menuRight, setMenuRight]       = useState(0)
  const [renaming, setRenaming]         = useState(false)
  const [renameInput, setRenameInput]   = useState('')
  const [deleteMode, setDeleteMode]     = useState<DeleteMode | null>(null)

  const accentHex = useMemo(
    () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f97316',
    [open],
  )

  // Tabs ordered newest-logged first, so the default active tab is the most recent.
  const catalog = useMemo(
    () => buildPresetCatalog('recent'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataVersion, open],
  )

  function closeMenu() {
    if (closeTimerRef.current) return
    setMenuClosing(true)
    closeTimerRef.current = setTimeout(() => {
      setMenuOpen(false)
      setMenuClosing(false)
      setRenaming(false)
      setRenameInput('')
      setDeleteMode(null)
      closeTimerRef.current = null
    }, 120)
  }

  // Close the menu on any outside tap.
  useEffect(() => {
    if (!menuOpen) return
    const handler = () => closeMenu()
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen])

  // Pick / re-validate the active preset whenever the catalog changes.
  useEffect(() => {
    if (!open) return
    setActiveNorm(prev => (prev && catalog.some(e => e.norm === prev)) ? prev : (catalog[0]?.norm ?? null))
  }, [open, catalog])

  // Highlight the active preset's days on the heatmap.
  useEffect(() => {
    if (open) onFocusPreset(activeNorm)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeNorm])

  // Reset everything when the sheet closes.
  useEffect(() => {
    if (!open) {
      setActiveNorm(null)
      setExpandedEx(null)
      setMenuOpen(false)
      setRenaming(false)
      setRenameInput('')
      setDeleteMode(null)
      onFocusPreset(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const active = activeNorm ? catalog.find(e => e.norm === activeNorm) ?? null : null

  // Sessions within the visible heatmap window, newest first (graph reverses it).
  const windowed = useMemo(() => {
    if (!activeNorm) return [] as PresetHistoryEntry[]
    const start = windowStart()
    const today = todayKey()
    return getPresetHistory(activeNorm).filter(e => dayIndex(e.date, start) >= 0 && e.date <= today)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNorm, dataVersion, open])

  // Per-exercise series, each clipped to the same visible window as `windowed`.
  const series = useMemo(() => {
    if (!activeNorm) return []
    const start = windowStart()
    const today = todayKey()
    return getPresetExerciseSeries(activeNorm, aliases)
      .map(s => ({
        ...s,
        points: s.points.filter(e => dayIndex(e.date, start) >= 0 && e.date <= today),
        entries: s.entries.filter(e => dayIndex(e.date, start) >= 0 && e.date <= today),
      }))
      .filter(s => s.points.length > 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNorm, dataVersion, open, aliases])

  // Session dates for this preset, oldest first — used to detect that an
  // exercise was skipped on a session that did happen (a real gap in its line).
  const sessionDates = useMemo(
    () => [...windowed].map(e => e.date).reverse(),
    [windowed],
  )

  // The preset's load per session, oldest first, and its change across the
  // window as a percentage of where it started.
  const loads = [...windowed].reverse()
  const loadPct = loads.length >= 2 && loads[0].load > 0
    ? Math.round((loads[loads.length - 1].load - loads[0].load) / loads[0].load * 100)
    : 0
  const sinceLast = windowed.length > 0
    ? dayIndex(todayKey(), windowStart()) - dayIndex(windowed[0].date, windowStart())
    : null
  // Recent cadence: average days between the last 5 sessions (needs ≥2).
  const recent = windowed.slice(0, 5)
  const cadence = recent.length >= 2
    ? Math.max(1, Math.round((dayIndex(recent[0].date, windowStart()) - dayIndex(recent[recent.length - 1].date, windowStart())) / (recent.length - 1)))
    : null

  function openMenu(e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    if (menuOpen && !menuClosing) { closeMenu(); return }
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    const rect = e.currentTarget.getBoundingClientRect()
    setMenuTop(rect.bottom + 6)
    setMenuRight(Math.max(window.innerWidth - rect.right, 24))
    setMenuOpen(true)
    setMenuClosing(false)
    setRenaming(false)
    setRenameInput('')
    setDeleteMode(null)
  }

  function handleRename() {
    if (!active) return
    const trimmed = renameInput.trim()
    if (trimmed) setPresetNickname(active.norm, trimmed)
    setRenaming(false)
    setRenameInput('')
    setMenuOpen(false)
    setMenuClosing(false)
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    onDataChange()
  }

  function handleDelete(mode: DeleteMode) {
    if (!active) return
    const norm = active.norm
    if (mode === 'label-only') deletePresetLabelOnly(norm)
    else deletePresetWithExercises(norm)
    setMenuOpen(false)
    setMenuClosing(false)
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    setDeleteMode(null)
    // Drop the deleted preset as active; the catalog effect reselects on next render.
    setActiveNorm(null)
    onDataChange()
  }

  return (
    <div
      className={`exercise-sheet${open ? ' open' : ''}`}
      style={height !== undefined ? { height: `${height}px` } : undefined}
    >
      <SheetHandle onClose={onClose} onResize={onResize} onResizeEnd={onResizeEnd} />

      <div className="sheet-header">
        <div className="sheet-title-row">
          <span className="sheet-title"><Sticker name="tag" className="sheet-title-icon lit" />Presets</span>
          {active && (
            <button className="ex-menu-btn" onClick={openMenu} aria-label="Preset options">
              <MoreVertical size={16} strokeWidth={2} />
            </button>
          )}
        </div>
        {catalog.length > 0 && (
          <div className="sort-chips preset-tabs">
            {catalog.map(entry => (
              <button
                key={entry.norm}
                onPointerDown={tap}
                className={`data-btn${activeNorm === entry.norm ? ' data-btn-filled' : ''}`}
                onClick={() => { setActiveNorm(entry.norm); setExpandedEx(null) }}
              >
                # {entry.displayName}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="preset-body">
        {!active ? (
          <p className="exercise-empty">No presets logged yet.</p>
        ) : (
          <>
            {windowed.length > 0 ? (
              <div className="data-stat-card preset-stat-card">
                <div className="preset-stat-left">
                  <div className="data-stat-size">
                    <span className="data-stat-size-value">{windowed.length}</span>
                    <span className="data-stat-size-label">session{windowed.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="data-stat-counts">
                    {cadence !== null && (
                      <span className="data-stat-count"><strong>~{cadence}d</strong> cadence</span>
                    )}
                    {sinceLast !== null && (sinceLast === 0
                      ? <span className="data-stat-count"><strong>today</strong> last</span>
                      : <span className="data-stat-count"><strong>{sinceLast}d</strong> since last</span>
                    )}
                  </div>
                </div>
                {/* Volume lives here, once for the whole preset: per exercise
                    it only restated the weight with reps and sets folded in. */}
                <div className="preset-vol">
                  <div className="preset-vol-head">
                    <span className="preset-vol-label">Volume</span>
                    <span className="preset-vol-value">{fmtFull(loads[loads.length - 1].load, weightUnit)}{weightUnit}</span>
                    <span className="preset-trend">
                      <TrendItem diff={loadPct} size={10} showDown={showDownTrend}>{Math.abs(loadPct)}%</TrendItem>
                    </span>
                  </div>
                  <MetricGraph
                    points={loads.map(e => ({ date: e.date, value: toUnit(e.load, weightUnit), label: '' }))}
                    accentHex={accentHex}
                    nodes="last"
                  />
                </div>
              </div>
            ) : (
              <div className="data-stat-card">
                <div className="data-stat-size">
                  <span className="data-stat-size-value"># {active.displayName}</span>
                  <span className="data-stat-size-label">no sessions in this window</span>
                </div>
              </div>
            )}

            {series.map(ex => {
              const chrono = [...ex.points].reverse()
              const done = new Set(chrono.map(e => e.date))
              const isExpanded = expandedEx === ex.norm
              const latest = chrono[chrono.length - 1]
              const before = chrono[chrono.length - 2]
              // A plain bodyweight movement's "weight" is just the bodyweight of
              // the day, so its drift says nothing about the exercise. Those
              // lead with reps instead — the figure they actually progress by.
              const bwOnly = ex.entries.every(e => e.exercise.bwExpr?.op === 'plain')
              const lead = bwOnly
                ? { of: (p: PresetExercisePoint) => p.reps, minRange: 4 }
                : { of: (p: PresetExercisePoint) => toUnit(p.weight, weightUnit), minRange: weightUnit === 'lbs' ? 10 : 5 }
              // The lead figure's change across the window — the one that moves
              // often enough to be worth a trend over the whole run.
              const leadDiff = lead.of(latest) - lead.of(chrono[0])
              return (
                <div key={ex.norm} className={`preset-block${isExpanded ? ' is-open' : ''}`} onPointerDown={tap}>
                  <button
                    className="preset-ex-field"
                    onClick={() => setExpandedEx(cur => cur === ex.norm ? null : ex.norm)}
                  >
                    {/* Everything to read sits in one column left of the graph:
                        name, then the weight with its trend beside it, then
                        reps × sets under it. */}
                    <span className="preset-ex-info">
                      <span className="preset-ex-name">{ex.displayName}</span>
                      <span className="preset-ex-lead">
                        <span className="preset-ex-weight">
                          {fmtNum(lead.of(latest))}
                          <span className="preset-ex-unit">{bwOnly ? 'reps' : weightUnit}</span>
                        </span>
                        <span className="preset-trend">
                          <TrendItem diff={Math.abs(leadDiff) < 0.05 ? 0 : leadDiff} size={10} showDown={showDownTrend}>
                            {bwOnly ? `${Math.abs(leadDiff)}` : formatWeightDiff(Math.abs(leadDiff), weightUnit)}
                          </TrendItem>
                        </span>
                      </span>
                      <span className="preset-ex-rs">
                        {!bwOnly && <>
                          <Figure value={latest.reps} prev={before?.reps} showDown={showDownTrend} />
                          <span className="history-sep"> × </span>
                        </>}
                        <Figure value={latest.sets} prev={before?.sets} suffix={bwOnly ? ' sets' : ''} showDown={showDownTrend} />
                      </span>
                    </span>

                    <MetricGraph
                      points={chrono.map((e, i) => {
                        // Gap when a later session happened that this exercise sat out.
                        const next = chrono[i + 1]
                        const skipped = next !== undefined && sessionDates.some(
                          d => d > e.date && d < next.date && !done.has(d),
                        )
                        return {
                          date: e.date,
                          value: lead.of(e),
                          label: fmtNum(lead.of(e)),
                          gapAfter: skipped,
                        }
                      })}
                      accentHex={accentHex}
                      // Roughly one plate change (or a few reps) — a 2.5kg bump
                      // should read as a step up, not as the same full-height
                      // climb a 40kg one gets.
                      minRange={lead.minRange}
                      showDots={isExpanded}
                      step
                    />
                  </button>

                  {/* Always mounted, so the list is there to slide in and out. */}
                  <div className={`history-expand-wrap${isExpanded ? ' history-expand-open' : ''}`}>
                    <div className="history-expand-inner">
                      <ExerciseHistoryList
                        entries={ex.entries}
                        unit={weightUnit}
                        showDownTrend={showDownTrend}
                        onSelectDate={onSelectDate}
                        className="history-list preset-history-list"
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* Preset ⋮ menu — portalled to escape overflow clipping */}
      {menuOpen && active && createPortal(
        <div
          className={`ex-dropdown${menuClosing ? ' closing' : ''}`}
          style={{ top: menuTop, right: menuRight }}
          onPointerDown={e => e.stopPropagation()}
        >
          {renaming ? (
            <div className="ex-dropdown-nick-row">
              <input
                className="nickname-input"
                value={renameInput}
                onChange={e => setRenameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') { setRenaming(false); setRenameInput('') }
                }}
                placeholder="display name…"
                autoFocus
              />
              <button className="nickname-confirm-btn" onClick={handleRename}>
                <Check size={11} strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            <button className="data-btn" onPointerDown={tap} onClick={() => setRenaming(true)}>
              <Pencil size={14} strokeWidth={2} />
              rename
            </button>
          )}

          <div className="dd-sep" />

          {deleteMode ? (
            <div className="dd-confirm">
              <span className="dd-confirm-label">
                {deleteMode === 'label-only'
                  ? 'Remove preset label only?'
                  : 'Remove preset + all exercises?'}
              </span>
              <div className="dd-confirm-btns">
                <button className="data-btn data-btn-danger" onPointerDown={tap} onClick={() => handleDelete(deleteMode)}>
                  <Trash2 size={13} strokeWidth={2} /> Remove
                </button>
                <button className="data-btn data-btn-ghost" onPointerDown={tap} onClick={() => setDeleteMode(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button className="data-btn data-btn-danger" onPointerDown={tap} onClick={() => setDeleteMode('label-only')}>
                <Trash2 size={14} strokeWidth={2} />
                delete label only
              </button>
              <button className="data-btn data-btn-danger" onPointerDown={tap} onClick={() => setDeleteMode('with-exercises')}>
                <Trash2 size={14} strokeWidth={2} />
                delete with exercises
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
