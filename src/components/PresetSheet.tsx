import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronRight, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import {
  buildPresetCatalog, setPresetNickname,
  deletePresetLabelOnly, deletePresetWithExercises,
  getPresetHistory, getPresetExerciseSeries,
  type PresetHistoryEntry, type PresetExercisePoint,
} from '../utils/presets'
import {
  type WeightUnit, type PresetMetric,
  getSavedPresetMetric, savePresetMetric,
} from '../utils/settings'
import { todayKey } from '../utils/storage'
import { windowStart, dayIndex } from '../utils/window'
import { tap } from '../utils/tap'
import { MetricGraph } from './MetricGraph'
import { ExerciseHistoryList } from './ExerciseHistoryList'
import { SegmentedControl } from './SegmentedControl'
import { SheetHandle } from './SheetHandle'

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

/** Abbreviated total volume for the graph pills so big numbers don't overlap. */
function fmtCompact(kg: number, unit: WeightUnit): string {
  const v = Math.round(toUnit(kg, unit))
  if (v >= 1000) {
    const k = v / 1000
    return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`
  }
  return `${v}`
}

/** Plain number for the weight/reps pills — no unit suffix, it wouldn't fit. */
function fmtNum(v: number): string {
  const r = Math.round(v * 10) / 10
  return r % 1 === 0 ? `${Math.round(r)}` : `${r}`
}

const METRIC_OPTIONS: { value: PresetMetric; label: string }[] = [
  { value: 'load',   label: 'Volume' },
  { value: 'weight', label: 'Weight' },
  { value: 'reps',   label: 'Reps' },
]

type DeleteMode = 'label-only' | 'with-exercises'

export function PresetSheet({ open, onClose, onFocusPreset, onSelectDate, dataVersion, onDataChange, height, onResize, onResizeEnd, weightUnit = 'kg', showDownTrend = true, aliases = {} }: Props) {
  const [activeNorm, setActiveNorm] = useState<string | null>(null)
  // Which exercise row has its history expanded (accordion — one at a time).
  const [expandedEx, setExpandedEx] = useState<string | null>(null)
  // Which figure every graph in the panel plots. Panel-local view preference,
  // but remembered — re-picking it on every open would be tedious.
  const [metric, setMetric] = useState<PresetMetric>(getSavedPresetMetric)

  // Stat-card ⋮ menu (rename / delete), portalled to body.
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

  // How the selected metric is read off a session point, labelled, and scaled.
  const metricView = useMemo(() => {
    switch (metric) {
      case 'weight':
        return {
          value: (p: PresetExercisePoint) => toUnit(p.weight, weightUnit),
          label: (p: PresetExercisePoint) => fmtNum(toUnit(p.weight, weightUnit)),
          // Roughly one plate change — a 2.5kg bump should read as a step up,
          // not as the same full-height climb a 40kg one gets.
          minRange: weightUnit === 'lbs' ? 10 : 5,
        }
      case 'reps':
        return {
          value: (p: PresetExercisePoint) => p.reps,
          label: (p: PresetExercisePoint) => `${p.reps}`,
          minRange: 4,
        }
      default:
        return {
          value: (p: PresetExercisePoint) => toUnit(p.load, weightUnit),
          label: (p: PresetExercisePoint) => fmtCompact(p.load, weightUnit),
          minRange: 0,   // spans orders of magnitude already — let it auto-scale
        }
    }
  }, [metric, weightUnit])

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

  const totalLoad = windowed.reduce((sum, e) => sum + e.load, 0)
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
          <span className="sheet-title">Presets</span>
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
        {active && series.length > 0 && (
          <div className="preset-metric-seg">
            <SegmentedControl
              options={METRIC_OPTIONS}
              value={metric}
              onChange={m => { setMetric(m); savePresetMetric(m) }}
            />
          </div>
        )}
      </div>

      <div className="preset-body">
        {!active ? (
          <p className="exercise-empty">No presets logged yet.</p>
        ) : (
          <>
            <div className="preset-stat-wrap">
              {windowed.length > 0 ? (
                <div className="data-stat-card">
                  <div className="data-stat-size">
                    <span className="data-stat-size-value">{windowed.length}</span>
                    <span className="data-stat-size-label">session{windowed.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="data-stat-counts">
                    <span className="data-stat-count"><strong>{fmtFull(totalLoad, weightUnit)}{weightUnit}</strong> total</span>
                    {cadence !== null && (
                      <span className="data-stat-count"><strong>~{cadence}d</strong> cadence</span>
                    )}
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
              <button className="ex-menu-btn preset-stat-menu" onClick={openMenu} aria-label="Preset options">
                <MoreVertical size={16} strokeWidth={2} />
              </button>
            </div>

            {series.map(ex => {
              const chrono = [...ex.points].reverse()
              const done = new Set(chrono.map(e => e.date))
              const latestSets = ex.entries[0]?.exercise.sets
              return (
                <div key={ex.norm} className="preset-block">
                  {/* The whole graph field is the expand hitbox; the name/latest
                      row floats on top of it rather than taking its own band. */}
                  <button
                    className="preset-ex-field"
                    onPointerDown={tap}
                    onClick={() => setExpandedEx(cur => cur === ex.norm ? null : ex.norm)}
                  >
                    <span className="preset-ex-head">
                      <span className="preset-ex-name">{ex.displayName}</span>
                      {/* Sets rarely move, so they don't earn a graph of their
                          own — the latest count rides along in the header. */}
                      {latestSets !== undefined && (
                        <span className="preset-ex-sets">{latestSets} set{latestSets !== 1 ? 's' : ''}</span>
                      )}
                      <ChevronRight
                        size={14}
                        strokeWidth={2}
                        className={`preset-ex-chevron${expandedEx === ex.norm ? ' open' : ''}`}
                      />
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
                          value: metricView.value(e),
                          label: metricView.label(e),
                          gapAfter: skipped,
                        }
                      })}
                      accentHex={accentHex}
                      minRange={metricView.minRange}
                      onSelectDate={onSelectDate}
                    />
                  </button>

                  {expandedEx === ex.norm && (
                    <ExerciseHistoryList
                      entries={ex.entries}
                      unit={weightUnit}
                      showDownTrend={showDownTrend}
                      onSelectDate={onSelectDate}
                      className="history-list preset-history-list"
                    />
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* Stat-card ⋮ menu — portalled to escape overflow clipping */}
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
