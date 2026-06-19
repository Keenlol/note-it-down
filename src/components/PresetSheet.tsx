import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import {
  buildPresetCatalog, setPresetNickname,
  deletePresetLabelOnly, deletePresetWithExercises,
  getPresetHistory, type PresetHistoryEntry,
} from '../utils/presets'
import { parseLine } from '../utils/parser'
import { type WeightUnit } from '../utils/settings'
import { todayKey } from '../utils/storage'
import { windowStart, dayIndex } from '../utils/window'
import { tap } from '../utils/tap'
import { MetricGraph } from './MetricGraph'
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
}

const POS_COLOR = 'rgb(45, 149, 47)'
const NEG_COLOR = 'rgb(200, 57, 57)'
const POS_BG    = 'rgba(45, 149, 47, 0.1)'
const NEG_BG    = 'rgba(200, 57, 57, 0.1)'
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

function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const now = new Date()
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return date.toLocaleDateString('en-US', opts)
}

/** Newest-first list of total-volume sessions; tapping a row jumps to that day. */
function VolumeHistoryList({ entries, unit, onSelectDate }: { entries: PresetHistoryEntry[]; unit: WeightUnit; onSelectDate: (date: string) => void }) {
  return (
    <div className="history-list preset-history-list">
      {entries.map((entry, i) => {
        const prev = entries[i + 1]
        const diff = prev ? entry.load - prev.load : 0
        const shown = Math.round(toUnit(Math.abs(diff), unit))
        const Icon = diff > 0 ? ArrowUp : ArrowDown
        return (
          <div
            key={entry.date}
            className="history-entry"
            onPointerDown={tap}
            onClick={() => onSelectDate(entry.date)}
          >
            <span className="history-date">{shortDate(entry.date)}</span>
            <span className="history-values">
              <span className="num">{fmtFull(entry.load, unit)}</span>
              <span className="history-sep"> {unit}</span>
            </span>
            {prev && shown !== 0 && (
              <span className="history-trend">
                <span
                  className="trend-item"
                  style={{ color: diff > 0 ? POS_COLOR : NEG_COLOR, background: diff > 0 ? POS_BG : NEG_BG }}
                >
                  <Icon size={11} strokeWidth={2.5} />{fmtFull(Math.abs(diff), unit)}{unit}
                </span>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

type DeleteMode = 'label-only' | 'with-exercises'

export function PresetSheet({ open, onClose, onFocusPreset, onSelectDate, dataVersion, onDataChange, height, onResize, onResizeEnd, weightUnit = 'kg' }: Props) {
  const [activeNorm, setActiveNorm] = useState<string | null>(null)

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

  const latest = windowed[0]
  const totalLoad = windowed.reduce((sum, e) => sum + e.load, 0)
  // Recent cadence: average days between the last 5 sessions (needs ≥2).
  const recent = windowed.slice(0, 5)
  const cadence = recent.length >= 2
    ? Math.max(1, Math.round((dayIndex(recent[0].date, windowStart()) - dayIndex(recent[recent.length - 1].date, windowStart())) / (recent.length - 1)))
    : null

  // Unique exercise names in the active preset (no weight/sets/reps) for the tag row.
  const exerciseNames: string[] = []
  if (active) {
    const seen = new Set<string>()
    for (const line of active.exercises) {
      const name = parseLine(line).exercise?.name
      if (!name) continue
      const key = name.toLowerCase()
      if (!seen.has(key)) { seen.add(key); exerciseNames.push(name) }
    }
  }

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
                onClick={() => setActiveNorm(entry.norm)}
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
            <div className="preset-stat-wrap">
              {windowed.length > 0 ? (
                <div className="data-stat-card">
                  <div className="data-stat-size">
                    <span className="data-stat-size-value">{fmtFull(latest.load, weightUnit)} {weightUnit}</span>
                  </div>
                  <div className="data-stat-counts">
                    <span className="data-stat-count"><strong>{windowed.length}</strong> session{windowed.length !== 1 ? 's' : ''}</span>
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

            <div className="preset-tags">
              {exerciseNames.map((name, i) => (
                <span key={i} className="preset-tag">{name}</span>
              ))}
            </div>

            {windowed.length > 0 && (
              <div className="preset-block">
                <MetricGraph
                  points={[...windowed].reverse().map(e => ({
                    date: e.date,
                    value: toUnit(e.load, weightUnit),
                    label: fmtCompact(e.load, weightUnit),
                  }))}
                  accentHex={accentHex}
                  onSelectDate={onSelectDate}
                />
                <VolumeHistoryList entries={windowed} unit={weightUnit} onSelectDate={onSelectDate} />
              </div>
            )}
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
