import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDown, ArrowUp, Check, ChevronRight, GitMerge, MoreVertical, Search, Tag, Trash2, X } from 'lucide-react'
import {
  buildCatalog, mergeExercises, addNickname, deleteExercise,
  relativeTime, getExerciseHistory,
  type SortMode, type HistoryEntry,
} from '../utils/exercises'
import { type Exercise } from '../utils/parser'
import { type WeightUnit, formatWeightDisplay, formatWeightDiff } from '../utils/settings'
import { tap } from '../utils/tap'
import { SheetHandle } from './SheetHandle'

interface Props {
  open: boolean
  onClose: () => void
  aliases: Record<string, string>
  onAliasesChange: (next: Record<string, string>) => void
  onFocusExercise: (norm: string | null) => void
  onSelectDate: (date: string) => void
  dataVersion: number
  onDataChange: () => void
  height?: number
  onResize: (height: number) => void
  onResizeEnd: () => void
  weightUnit?: WeightUnit
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'count',  label: 'Most used' },
  { value: 'recent', label: 'Recent' },
  { value: 'az',     label: 'A → Z' },
  { value: 'za',     label: 'Z → A' },
]

const POS_COLOR = 'rgb(45, 149, 47)'
const NEG_COLOR = 'rgb(200, 57, 57)'
const POS_BG    = 'rgba(45, 149, 47, 0.1)'
const NEG_BG    = 'rgba(200, 57, 57, 0.1)'

function buildTrend(curr: Exercise, prev: Exercise, unit: WeightUnit): React.ReactNode | null {
  const items: React.ReactNode[] = []

  const sDiff = curr.sets - prev.sets
  if (sDiff !== 0) {
    const Icon = sDiff > 0 ? ArrowUp : ArrowDown
    const abs = Math.abs(sDiff)
    items.push(
      <span key="s" className="trend-item" style={{ color: sDiff > 0 ? POS_COLOR : NEG_COLOR, background: sDiff > 0 ? POS_BG : NEG_BG }}>
        <Icon size={11} strokeWidth={2.5} />{abs} set{abs !== 1 ? 's' : ''}
      </span>
    )
  }

  const rDiff = curr.reps - prev.reps
  if (rDiff !== 0) {
    const Icon = rDiff > 0 ? ArrowUp : ArrowDown
    const abs = Math.abs(rDiff)
    items.push(
      <span key="r" className="trend-item" style={{ color: rDiff > 0 ? POS_COLOR : NEG_COLOR, background: rDiff > 0 ? POS_BG : NEG_BG }}>
        <Icon size={11} strokeWidth={2.5} />{abs} rep{abs !== 1 ? 's' : ''}
      </span>
    )
  }

  // Skip weight diff when both are plain bodyweight (same resolved weight means same bw day)
  const wDiff = curr.weightKg - prev.weightKg
  if (Math.abs(wDiff) >= 0.5 && !(curr.bwExpr?.op === 'plain' && prev.bwExpr?.op === 'plain')) {
    const Icon = wDiff > 0 ? ArrowUp : ArrowDown
    items.push(
      <span key="w" className="trend-item" style={{ color: wDiff > 0 ? POS_COLOR : NEG_COLOR, background: wDiff > 0 ? POS_BG : NEG_BG }}>
        <Icon size={11} strokeWidth={2.5} />{formatWeightDiff(Math.abs(wDiff), unit)}
      </span>
    )
  }

  if (items.length === 0) return null
  return <>{items}</>
}

function shortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const now = new Date()
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return date.toLocaleDateString('en-US', opts)
}

function HistoryList({ entries, unit, onSelectDate }: { entries: HistoryEntry[]; unit: WeightUnit; onSelectDate: (date: string) => void }) {
  if (entries.length === 0) {
    return <div className="history-empty">No entries found.</div>
  }
  return (
    <div className="history-list">
      {entries.map((entry, i) => {
        const prev = entries[i + 1]
        const trend = prev ? buildTrend(entry.exercise, prev.exercise, unit) : null
        return (
          <div
            key={`${entry.date}-${i}`}
            className="history-entry"
            onPointerDown={tap}
            onClick={() => onSelectDate(entry.date)}
          >
            <span className="history-date">{shortDate(entry.date)}</span>
            <span className="history-values">
              <span className="num">{formatWeightDisplay(entry.exercise.weightKg, unit)}</span>
              <span className="history-sep"> × </span>
              <span className="num">{entry.exercise.reps}</span>
              <span className="history-sep"> × </span>
              <span className="num">{entry.exercise.sets}</span>
            </span>
            {trend && <span className="history-trend">{trend}</span>}
          </div>
        )
      })}
    </div>
  )
}

export function ExerciseSheet({
  open, onClose, aliases, onAliasesChange, onFocusExercise, onSelectDate, dataVersion, onDataChange, height,
  onResize, onResizeEnd, weightUnit = 'kg',
}: Props) {
  const [sortMode, setSortMode]           = useState<SortMode>('count')
  const [query, setQuery]                 = useState('')
  const listRef   = useRef<HTMLDivElement>(null)
  const snapshots = useRef<Map<string, number>>(new Map())
  const [mergeMode, setMergeMode]         = useState(false)
  const [mergeTarget, setMergeTarget]     = useState<string | null>(null)
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set())
  const [expandedExercise, setExpandedExercise] = useState<string | null>(null)

  // Dropdown state
  const [openDropdownFor, setOpenDropdownFor] = useState<string | null>(null)
  const [dropdownClosing, setDropdownClosing] = useState(false)
  const closeTimerRef                         = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dropdownTop, setDropdownTop]         = useState(0)
  const [dropdownRight, setDropdownRight]     = useState(0)
  const [addingNickFor, setAddingNickFor]     = useState<string | null>(null)
  const [nickInput, setNickInput]             = useState('')
  const [deleteConfirmFor, setDeleteConfirmFor] = useState<string | null>(null)

  function closeDropdown() {
    if (closeTimerRef.current) return
    setDropdownClosing(true)
    closeTimerRef.current = setTimeout(() => {
      setOpenDropdownFor(null)
      setDropdownClosing(false)
      setAddingNickFor(null)
      setNickInput('')
      setDeleteConfirmFor(null)
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
      setAddingNickFor(null)
      setNickInput('')
      setDeleteConfirmFor(null)
      setOpenDropdownFor(null)
      setMergeMode(false)
      setMergeTarget(null)
      setMergeSelected(new Set())
      setExpandedExercise(null)
      setQuery('')
      onFocusExercise(null)
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
    () => buildCatalog(aliases, sortMode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aliases, sortMode, dataVersion],
  )

  const visibleCatalog = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return catalog
    return catalog.filter(e =>
      e.displayName.toLowerCase().includes(q) || e.nicknames.some(n => n.includes(q)),
    )
  }, [catalog, query])

  // Persists the last-loaded history so content stays visible during the collapse
  // animation instead of snapping to "No entries found" mid-transition.
  const lastHistoryRef = useRef<Map<string, HistoryEntry[]>>(new Map())

  const historyMap = useMemo(() => {
    if (!expandedExercise) return lastHistoryRef.current   // reuse stale data while collapsing
    const map = new Map([[expandedExercise, getExerciseHistory(expandedExercise, aliases)]])
    lastHistoryRef.current = map
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedExercise, aliases, dataVersion])

  function toggleExpand(norm: string) {
    if (expandedExercise === norm) {
      setExpandedExercise(null)
      onFocusExercise(null)
    } else {
      setExpandedExercise(norm)
      onFocusExercise(norm)
      setOpenDropdownFor(null)
    }
  }

  function openMenu(norm: string, e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    if (openDropdownFor === norm && !dropdownClosing) {
      closeDropdown()
      return
    }
    // Cancel any in-flight close and open immediately
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setDropdownTop(rect.bottom + 6)
    setDropdownRight(Math.max(window.innerWidth - rect.right, 24))
    setOpenDropdownFor(norm)
    setDropdownClosing(false)
    setAddingNickFor(null)
    setNickInput('')
    setDeleteConfirmFor(null)
  }

  function handleMergeFromDropdown(norm: string) {
    setMergeMode(true)
    setMergeTarget(norm)
    setOpenDropdownFor(null)
    setDropdownClosing(false)
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
  }

  function handleMergeTap(norm: string) {
    if (mergeTarget === null) { setMergeTarget(norm); return }
    if (norm === mergeTarget) { setMergeTarget(null); setMergeSelected(new Set()); return }
    setMergeSelected(prev => {
      const next = new Set(prev)
      next.has(norm) ? next.delete(norm) : next.add(norm)
      return next
    })
  }

  function cancelMerge() {
    setMergeMode(false); setMergeTarget(null); setMergeSelected(new Set())
  }

  function confirmMerge() {
    if (!mergeTarget || mergeSelected.size === 0) return
    onAliasesChange(mergeExercises(mergeTarget, Array.from(mergeSelected), aliases))
    cancelMerge()
  }

  function handleAddNickname(norm: string) {
    const trimmed = nickInput.trim()
    if (trimmed) onAliasesChange(addNickname(trimmed, norm, aliases))
    setAddingNickFor(null)
    setNickInput('')
    setOpenDropdownFor(null)
  }

  function handleDelete(norm: string) {
    onAliasesChange(deleteExercise(norm, aliases))
    onDataChange()
    setOpenDropdownFor(null)
    setDeleteConfirmFor(null)
    if (expandedExercise === norm) {
      setExpandedExercise(null)
      onFocusExercise(null)
    }
  }

  const mergeCount = (mergeTarget ? 1 : 0) + mergeSelected.size
  const dropdownEntry = openDropdownFor ? catalog.find(e => e.norm === openDropdownFor) : null

  return (
    <div className={`exercise-sheet${open ? ' open' : ''}`} style={height !== undefined ? { height: `${height}px` } : undefined}>
      <SheetHandle onClose={onClose} onResize={onResize} onResizeEnd={onResizeEnd} />

      <div className="sheet-header">
        <div className="sheet-title-row">
          <span className="sheet-title">Exercises</span>
        </div>

        {/* Search bar — hidden during merge mode */}
        {!mergeMode && (
          <div className="sheet-search">
            <Search size={15} strokeWidth={2} />
            <input
              className="search-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search exercises…"
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
        )}

        {/* Sort chips — hidden during merge mode */}
        {!mergeMode && (
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
        )}

        {/* Merge action bar — replaces sort chips during merge mode */}
        {mergeMode && (
          <div className="merge-action-bar">
            <button className="data-btn data-btn-ghost" onPointerDown={tap} onClick={cancelMerge}>
              Cancel
            </button>
            <button
              className="data-btn"
              onPointerDown={tap}
              onClick={confirmMerge}
              disabled={mergeCount < 2}
            >
              <GitMerge size={14} strokeWidth={2} />
              Merge{mergeCount >= 2 ? ` ${mergeCount}` : ''}
            </button>
          </div>
        )}
      </div>

      <div className="exercise-list" ref={listRef}>
        {catalog.length === 0 && (
          <p className="exercise-empty">No exercises logged yet.</p>
        )}
        {catalog.length > 0 && visibleCatalog.length === 0 && (
          <p className="exercise-empty">No matches for “{query.trim()}”.</p>
        )}
        {visibleCatalog.map(entry => {
          const isMergeTarget   = mergeTarget === entry.norm
          const isMergeSelected = mergeSelected.has(entry.norm)
          const isExpanded      = expandedExercise === entry.norm

          return (
            <div
              key={entry.norm}
              onPointerDown={tap}
              data-norm={entry.norm}
              className={`exercise-item-wrap${isExpanded ? ' ex-expanded' : ''}`}
            >
              {/* ── Main row ── */}
              <div
                className={[
                  'exercise-item',
                  mergeMode       ? 'merge-mode'     : '',
                  isMergeTarget   ? 'merge-target'   : '',
                  isMergeSelected ? 'merge-selected' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => mergeMode ? handleMergeTap(entry.norm) : toggleExpand(entry.norm)}
              >
                <div className={`merge-circle${!mergeMode ? ' merge-circle-hidden' : isMergeTarget ? ' target' : isMergeSelected ? ' selected' : ''}`} />

                <div className="ex-row-left">
                  {!mergeMode && <ChevronRight size={13} strokeWidth={2.5} className={`ex-chevron${isExpanded ? ' ex-chevron-open' : ''}`} />}
                  <span className="ex-name">{entry.displayName}</span>
                  {entry.nicknames.map(n => (
                    <span key={n} className="ex-nickname">&nbsp;/ {n}</span>
                  ))}
                </div>

                <div className="ex-row-right">
                  <span className="ex-last">{relativeTime(entry.lastSeen)}</span>
                  <span className="ex-count">{entry.count}×</span>
                  {!mergeMode && (
                    <button className="ex-menu-btn" onClick={e => openMenu(entry.norm, e)}>
                      <MoreVertical size={15} strokeWidth={2} />
                    </button>
                  )}
                </div>
              </div>

              {/* ── Expanded history ── */}
              <div className={`history-expand-wrap${isExpanded ? ' history-expand-open' : ''}`}>
                <div className="history-expand-inner">
                  <HistoryList entries={historyMap.get(entry.norm) ?? []} unit={weightUnit} onSelectDate={onSelectDate} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Dropdown — portalled to body to escape overflow:auto clipping */}
      {dropdownEntry && createPortal(
        <div
          className={`ex-dropdown${dropdownClosing ? ' closing' : ''}`}
          style={{ top: dropdownTop, right: dropdownRight }}
          onPointerDown={e => e.stopPropagation()}
        >
          {addingNickFor === dropdownEntry.norm ? (
            <div className="ex-dropdown-nick-row">
              <input
                className="nickname-input"
                value={nickInput}
                onChange={e => setNickInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAddNickname(dropdownEntry.norm)
                  if (e.key === 'Escape') { setAddingNickFor(null); setNickInput('') }
                }}
                placeholder="nickname…"
                autoFocus
              />
              <button className="nickname-confirm-btn" onClick={() => handleAddNickname(dropdownEntry.norm)}>
                <Check size={11} strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            <button className="data-btn" onPointerDown={tap} onClick={() => setAddingNickFor(dropdownEntry.norm)}>
              <Tag size={14} strokeWidth={2} />
              add nickname
            </button>
          )}

          <button className="data-btn" onPointerDown={tap} onClick={() => handleMergeFromDropdown(dropdownEntry.norm)}>
            <GitMerge size={14} strokeWidth={2} />
            merge
          </button>

          <div className="dd-sep" />

          {deleteConfirmFor === dropdownEntry.norm ? (
            <div className="dd-confirm">
              <span className="dd-confirm-label">
                Remove from {dropdownEntry.count} day{dropdownEntry.count !== 1 ? 's' : ''}?
              </span>
              <div className="dd-confirm-btns">
                <button className="data-btn data-btn-danger" onPointerDown={tap} onClick={() => handleDelete(dropdownEntry.norm)}>
                  <Trash2 size={13} strokeWidth={2} /> Remove
                </button>
                <button className="data-btn data-btn-ghost" onPointerDown={tap} onClick={() => setDeleteConfirmFor(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="data-btn data-btn-danger"
              onPointerDown={tap}
              onClick={() => setDeleteConfirmFor(dropdownEntry.norm)}
            >
              <Trash2 size={14} strokeWidth={2} />
              delete from history
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
