import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, ChevronRight, MoreVertical, Pencil, Search, Trash2, X } from 'lucide-react'
import {
  buildPresetCatalog, setPresetNickname,
  deletePresetLabelOnly, deletePresetWithExercises,
  getPresetHistory, relativeTime,
  type SortMode, type PresetHistoryEntry,
} from '../utils/presets'
import { type WeightUnit } from '../utils/settings'
import { tap } from '../utils/tap'
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

/** Total load (weight × reps × sets) is stored in kg; render it in the user's unit. */
function fmtLoad(kg: number, unit: WeightUnit): string {
  const v = unit === 'lbs' ? kg / KG_PER_LB : kg
  return `${Math.round(v)}`
}

function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const now = new Date()
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return date.toLocaleDateString('en-US', opts)
}

function VolumeHistoryList({ entries, unit, onSelectDate }: { entries: PresetHistoryEntry[]; unit: WeightUnit; onSelectDate: (date: string) => void }) {
  if (entries.length === 0) {
    return <div className="history-empty">No entries found.</div>
  }
  return (
    <div className="history-list">
      {entries.map((entry, i) => {
        const prev = entries[i + 1]
        const diff = prev ? entry.load - prev.load : 0
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
              <span className="num">{fmtLoad(entry.load, unit)}</span>
              <span className="history-sep"> {unit}</span>
            </span>
            {prev && Math.round(unit === 'lbs' ? diff / KG_PER_LB : diff) !== 0 && (
              <span className="history-trend">
                <span
                  className="trend-item"
                  style={{ color: diff > 0 ? POS_COLOR : NEG_COLOR, background: diff > 0 ? POS_BG : NEG_BG }}
                >
                  <Icon size={11} strokeWidth={2.5} />{fmtLoad(Math.abs(diff), unit)}
                </span>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'count',  label: 'Most used' },
  { value: 'recent', label: 'Recent' },
  { value: 'az',     label: 'A → Z' },
  { value: 'za',     label: 'Z → A' },
]

type DeleteMode = 'label-only' | 'with-exercises'

export function PresetSheet({ open, onClose, onFocusPreset, onSelectDate, dataVersion, onDataChange, height, onResize, onResizeEnd, weightUnit = 'kg' }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>('count')
  const [query, setQuery]       = useState('')
  const listRef   = useRef<HTMLDivElement>(null)
  const snapshots = useRef<Map<string, number>>(new Map())
  const [expandedPreset, setExpandedPreset] = useState<string | null>(null)

  // Dropdown state
  const [openDropdownFor, setOpenDropdownFor] = useState<string | null>(null)
  const [dropdownClosing, setDropdownClosing] = useState(false)
  const closeTimerRef                         = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dropdownTop, setDropdownTop]         = useState(0)
  const [dropdownRight, setDropdownRight]     = useState(0)
  const [renamingFor, setRenamingFor]         = useState<string | null>(null)
  const [renameInput, setRenameInput]         = useState('')
  const [deleteConfirmFor, setDeleteConfirmFor] = useState<string | null>(null)
  const [deleteMode, setDeleteMode]           = useState<DeleteMode | null>(null)

  function closeDropdown() {
    if (closeTimerRef.current) return
    setDropdownClosing(true)
    closeTimerRef.current = setTimeout(() => {
      setOpenDropdownFor(null)
      setDropdownClosing(false)
      setRenamingFor(null)
      setRenameInput('')
      setDeleteConfirmFor(null)
      setDeleteMode(null)
      closeTimerRef.current = null
    }, 120)
  }

  // Close dropdown on outside tap
  useEffect(() => {
    if (!openDropdownFor) return
    const handler = () => closeDropdown()
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDropdownFor])

  // Reset when sheet closes
  useEffect(() => {
    if (!open) {
      setOpenDropdownFor(null)
      setRenamingFor(null)
      setRenameInput('')
      setDeleteConfirmFor(null)
      setDeleteMode(null)
      setExpandedPreset(null)
      setQuery('')
      onFocusPreset(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // FLIP: after sort re-render, animate each item from its old position to its new one
  useEffect(() => {
    if (snapshots.current.size === 0 || !listRef.current) return
    listRef.current.querySelectorAll<HTMLElement>('[data-norm]').forEach(el => {
      const prev = snapshots.current.get(el.dataset.norm!)
      if (prev === undefined) return
      const delta = prev - el.getBoundingClientRect().top
      if (Math.abs(delta) < 1) return
      el.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        { duration: 280, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' },
      )
    })
    snapshots.current.clear()
  }, [sortMode])

  const catalog = useMemo(
    () => buildPresetCatalog(sortMode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortMode, dataVersion],
  )

  const visibleCatalog = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter(e => e.displayName.toLowerCase().includes(q) || e.norm.includes(q))
  }, [catalog, query])

  // Persists last-loaded history so content stays visible during the collapse animation.
  const lastHistoryRef = useRef<Map<string, PresetHistoryEntry[]>>(new Map())

  const historyMap = useMemo(() => {
    if (!expandedPreset) return lastHistoryRef.current
    const map = new Map([[expandedPreset, getPresetHistory(expandedPreset)]])
    lastHistoryRef.current = map
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedPreset, dataVersion])

  function toggleExpand(norm: string) {
    if (expandedPreset === norm) {
      setExpandedPreset(null)
      onFocusPreset(null)
    } else {
      setExpandedPreset(norm)
      onFocusPreset(norm)
      setOpenDropdownFor(null)
    }
  }

  function openMenu(norm: string, e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    if (openDropdownFor === norm && !dropdownClosing) {
      closeDropdown()
      return
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setDropdownTop(rect.bottom + 6)
    setDropdownRight(Math.max(window.innerWidth - rect.right, 24))
    setOpenDropdownFor(norm)
    setDropdownClosing(false)
    setRenamingFor(null)
    setRenameInput('')
    setDeleteConfirmFor(null)
    setDeleteMode(null)
  }

  function handleRename(norm: string) {
    const trimmed = renameInput.trim()
    if (trimmed) setPresetNickname(norm, trimmed)
    setRenamingFor(null)
    setRenameInput('')
    setOpenDropdownFor(null)
    setDropdownClosing(false)
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    onDataChange()
  }

  function handleDelete(norm: string, mode: DeleteMode) {
    if (mode === 'label-only') deletePresetLabelOnly(norm)
    else deletePresetWithExercises(norm)
    onDataChange()
    setOpenDropdownFor(null)
    setDropdownClosing(false)
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
    setDeleteConfirmFor(null)
    setDeleteMode(null)
  }

  const dropdownEntry = openDropdownFor ? catalog.find(e => e.norm === openDropdownFor) : null

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
        <div className="sheet-search">
          <Search size={15} strokeWidth={2} />
          <input
            className="search-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search presets…"
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
        <div className="sort-chips">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onPointerDown={tap}
              className={`data-btn${sortMode === opt.value ? ' data-btn-filled' : ''}`}
              onClick={() => {
                listRef.current?.querySelectorAll<HTMLElement>('[data-norm]').forEach(el => {
                  snapshots.current.set(el.dataset.norm!, el.getBoundingClientRect().top)
                })
                setSortMode(opt.value)
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="exercise-list" ref={listRef}>
        {catalog.length === 0 && (
          <p className="exercise-empty">No presets logged yet.</p>
        )}
        {catalog.length > 0 && visibleCatalog.length === 0 && (
          <p className="exercise-empty">No matches for “{query.trim()}”.</p>
        )}
        {visibleCatalog.map(entry => {
          const isExpanded = expandedPreset === entry.norm
          return (
            <div
              key={entry.norm}
              onPointerDown={tap}
              data-norm={entry.norm}
              className={`exercise-item-wrap preset-item-wrap${isExpanded ? ' ex-expanded' : ''}`}
            >
              {/* Main row — click toggles the volume-history dropdown */}
              <div className="exercise-item" onClick={() => toggleExpand(entry.norm)}>
                <div className="ex-row-left">
                  <ChevronRight size={13} strokeWidth={2.5} className={`ex-chevron${isExpanded ? ' ex-chevron-open' : ''}`} />
                  <span className="ex-name"># {entry.displayName}</span>
                </div>
                <div className="ex-row-right">
                  <span className="ex-last">{relativeTime(entry.lastSeen)}</span>
                  <span className="ex-count">{entry.count}×</span>
                  <button className="ex-menu-btn" onClick={e => openMenu(entry.norm, e)}>
                    <MoreVertical size={15} strokeWidth={2} />
                  </button>
                </div>
              </div>

              {/* Always-visible exercise list */}
              <div className="preset-exercises">
                {entry.exercises.map((line, i) => (
                  <div key={i} className="preset-exercise-line">{line}</div>
                ))}
              </div>

              {/* Expandable total-volume history */}
              <div className={`history-expand-wrap${isExpanded ? ' history-expand-open' : ''}`}>
                <div className="history-expand-inner">
                  <VolumeHistoryList entries={historyMap.get(entry.norm) ?? []} unit={weightUnit} onSelectDate={onSelectDate} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Dropdown — portalled to escape overflow clipping */}
      {dropdownEntry && createPortal(
        <div
          className={`ex-dropdown${dropdownClosing ? ' closing' : ''}`}
          style={{ top: dropdownTop, right: dropdownRight }}
          onPointerDown={e => e.stopPropagation()}
        >
          {/* Rename */}
          {renamingFor === dropdownEntry.norm ? (
            <div className="ex-dropdown-nick-row">
              <input
                className="nickname-input"
                value={renameInput}
                onChange={e => setRenameInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRename(dropdownEntry.norm)
                  if (e.key === 'Escape') { setRenamingFor(null); setRenameInput('') }
                }}
                placeholder="display name…"
                autoFocus
              />
              <button className="nickname-confirm-btn" onClick={() => handleRename(dropdownEntry.norm)}>
                <Check size={11} strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            <button className="data-btn" onPointerDown={tap} onClick={() => setRenamingFor(dropdownEntry.norm)}>
              <Pencil size={14} strokeWidth={2} />
              rename
            </button>
          )}

          <div className="dd-sep" />

          {/* Delete — two-step with mode selection */}
          {deleteConfirmFor === dropdownEntry.norm ? (
            <div className="dd-confirm">
              <span className="dd-confirm-label">
                {deleteMode === 'label-only'
                  ? 'Remove preset label only?'
                  : 'Remove preset + all exercises?'}
              </span>
              <div className="dd-confirm-btns">
                <button className="data-btn data-btn-danger" onPointerDown={tap} onClick={() => handleDelete(dropdownEntry.norm, deleteMode!)}>
                  <Trash2 size={13} strokeWidth={2} /> Remove
                </button>
                <button className="data-btn data-btn-ghost" onPointerDown={tap} onClick={() => { setDeleteConfirmFor(null); setDeleteMode(null) }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                className="data-btn data-btn-danger"
                onPointerDown={tap}
                onClick={() => { setDeleteConfirmFor(dropdownEntry.norm); setDeleteMode('label-only') }}
              >
                <Trash2 size={14} strokeWidth={2} />
                delete label only
              </button>
              <button
                className="data-btn data-btn-danger"
                onPointerDown={tap}
                onClick={() => { setDeleteConfirmFor(dropdownEntry.norm); setDeleteMode('with-exercises') }}
              >
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
