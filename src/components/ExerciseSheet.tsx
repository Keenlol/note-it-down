import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, MoreVertical } from 'lucide-react'
import {
  buildCatalog, mergeExercises, addNickname, deleteExercise,
  relativeTime, type SortMode,
} from '../utils/exercises'

interface Props {
  open: boolean
  onClose: () => void
  aliases: Record<string, string>
  onAliasesChange: (next: Record<string, string>) => void
  onFocusExercise: (norm: string | null) => void
  dataVersion: number
  onDataChange: () => void
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'count',  label: 'Most used' },
  { value: 'recent', label: 'Recent' },
  { value: 'az',     label: 'A → Z' },
  { value: 'za',     label: 'Z → A' },
]

export function ExerciseSheet({
  open, onClose, aliases, onAliasesChange, onFocusExercise, dataVersion, onDataChange,
}: Props) {
  const [sortMode, setSortMode]           = useState<SortMode>('count')
  const [mergeMode, setMergeMode]         = useState(false)
  const [mergeTarget, setMergeTarget]     = useState<string | null>(null)
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set())

  // Dropdown state
  const [openDropdownFor, setOpenDropdownFor] = useState<string | null>(null)
  const [dropdownTop, setDropdownTop]         = useState(0)
  const [dropdownRight, setDropdownRight]     = useState(0)
  const [addingNickFor, setAddingNickFor]     = useState<string | null>(null)
  const [nickInput, setNickInput]             = useState('')
  const [deleteConfirmFor, setDeleteConfirmFor] = useState<string | null>(null)

  // Close dropdown on outside tap
  useEffect(() => {
    if (!openDropdownFor) return
    const close = () => {
      setOpenDropdownFor(null)
      setAddingNickFor(null)
      setNickInput('')
      setDeleteConfirmFor(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
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
      onFocusExercise(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const catalog = useMemo(
    () => buildCatalog(aliases, sortMode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aliases, sortMode, dataVersion],
  )

  function openMenu(norm: string, e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    if (openDropdownFor === norm) {
      setOpenDropdownFor(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setDropdownTop(rect.bottom + 6)
    setDropdownRight(window.innerWidth - rect.right)
    setOpenDropdownFor(norm)
    setAddingNickFor(null)
    setNickInput('')
    setDeleteConfirmFor(null)
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
    onFocusExercise(null)
  }

  const mergeCount = (mergeTarget ? 1 : 0) + mergeSelected.size

  // The open dropdown entry
  const dropdownEntry = openDropdownFor ? catalog.find(e => e.norm === openDropdownFor) : null

  return (
    <div className={`exercise-sheet${open ? ' open' : ''}`}>
      <div className="sheet-handle-wrap" onClick={onClose}>
        <div className="sheet-handle" />
      </div>

      <div className="sheet-header">
        <div className="sheet-title-row">
          <span className="sheet-title">Exercises</span>
          {mergeMode ? (
            <div className="merge-actions">
              <button className="merge-cancel-btn" onClick={cancelMerge}>Cancel</button>
              <button className="merge-confirm-btn" disabled={mergeCount < 2} onClick={confirmMerge}>
                Merge {mergeCount >= 2 ? mergeCount : ''}
              </button>
            </div>
          ) : (
            <button className="merge-init-btn" onClick={() => setMergeMode(true)}>Merge</button>
          )}
        </div>
        <div className="sort-chips">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`sort-chip${sortMode === opt.value ? ' active' : ''}`}
              onClick={() => setSortMode(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="exercise-list">
        {catalog.length === 0 && (
          <p className="exercise-empty">No exercises logged yet.</p>
        )}
        {catalog.map(entry => {
          const isMergeTarget   = mergeTarget === entry.norm
          const isMergeSelected = mergeSelected.has(entry.norm)

          return (
            <div
              key={entry.norm}
              className={[
                'exercise-item',
                mergeMode       ? 'merge-mode'     : '',
                isMergeTarget   ? 'merge-target'   : '',
                isMergeSelected ? 'merge-selected' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => mergeMode && handleMergeTap(entry.norm)}
            >
              {mergeMode && (
                <div className={`merge-circle${isMergeTarget ? ' target' : isMergeSelected ? ' selected' : ''}`} />
              )}

              <div className="ex-row-left">
                <span className="ex-name">{entry.displayName}</span>
                {entry.nicknames.map(n => (
                  <span key={n} className="nickname-tag">{n}</span>
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
          )
        })}
      </div>

      {/* Dropdown — portalled to body to escape overflow:auto clipping */}
      {dropdownEntry && createPortal(
        <div
          className="ex-dropdown"
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
            <button className="ex-dropdown-item" onClick={() => setAddingNickFor(dropdownEntry.norm)}>
              add nickname
            </button>
          )}

          {deleteConfirmFor === dropdownEntry.norm ? (
            <div className="ex-dropdown-confirm">
              <span className="ex-dropdown-confirm-label">
                Remove from {dropdownEntry.count} day{dropdownEntry.count !== 1 ? 's' : ''}?
              </span>
              <div className="ex-dropdown-confirm-actions">
                <button className="delete-yes-btn" onClick={() => handleDelete(dropdownEntry.norm)}>Remove</button>
                <button className="delete-no-btn" onClick={() => setDeleteConfirmFor(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button
              className="ex-dropdown-item ex-dropdown-delete"
              onClick={() => setDeleteConfirmFor(dropdownEntry.norm)}
            >
              delete from history
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
