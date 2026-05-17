import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, MoreVertical } from 'lucide-react'
import {
  buildPresetCatalog, setPresetNickname,
  deletePresetLabelOnly, deletePresetWithExercises,
  relativeTime, type SortMode,
} from '../utils/presets'

interface Props {
  open: boolean
  onClose: () => void
  dataVersion: number
  onDataChange: () => void
  height?: number
}

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'count',  label: 'Most used' },
  { value: 'recent', label: 'Recent' },
  { value: 'az',     label: 'A → Z' },
  { value: 'za',     label: 'Z → A' },
]

type DeleteMode = 'label-only' | 'with-exercises'

export function PresetSheet({ open, onClose, dataVersion, onDataChange, height }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>('count')
  const [listKey, setListKey]   = useState(0)

  // Dropdown state
  const [openDropdownFor, setOpenDropdownFor] = useState<string | null>(null)
  const [dropdownTop, setDropdownTop]         = useState(0)
  const [dropdownRight, setDropdownRight]     = useState(0)
  const [renamingFor, setRenamingFor]         = useState<string | null>(null)
  const [renameInput, setRenameInput]         = useState('')
  const [deleteConfirmFor, setDeleteConfirmFor] = useState<string | null>(null)
  const [deleteMode, setDeleteMode]           = useState<DeleteMode | null>(null)

  // Close dropdown on outside tap
  useEffect(() => {
    if (!openDropdownFor) return
    const close = () => {
      setOpenDropdownFor(null)
      setRenamingFor(null)
      setRenameInput('')
      setDeleteConfirmFor(null)
      setDeleteMode(null)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [openDropdownFor])

  // Reset when sheet closes
  useEffect(() => {
    if (!open) {
      setOpenDropdownFor(null)
      setRenamingFor(null)
      setRenameInput('')
      setDeleteConfirmFor(null)
      setDeleteMode(null)
    }
  }, [open])

  const catalog = useMemo(
    () => buildPresetCatalog(sortMode),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortMode, dataVersion],
  )

  function openMenu(norm: string, e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    if (openDropdownFor === norm) { setOpenDropdownFor(null); return }
    const rect = e.currentTarget.getBoundingClientRect()
    setDropdownTop(rect.bottom + 6)
    setDropdownRight(window.innerWidth - rect.right)
    setOpenDropdownFor(norm)
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
    onDataChange()
  }

  function handleDelete(norm: string, mode: DeleteMode) {
    if (mode === 'label-only') deletePresetLabelOnly(norm)
    else deletePresetWithExercises(norm)
    onDataChange()
    setOpenDropdownFor(null)
    setDeleteConfirmFor(null)
    setDeleteMode(null)
  }

  const dropdownEntry = openDropdownFor ? catalog.find(e => e.norm === openDropdownFor) : null

  return (
    <div
      className={`exercise-sheet${open ? ' open' : ''}`}
      style={height !== undefined ? { height: `${height}px` } : undefined}
    >
      <div className="sheet-handle-wrap" onClick={onClose}>
        <div className="sheet-handle" />
      </div>

      <div className="sheet-header">
        <div className="sheet-title-row">
          <span className="sheet-title">Presets</span>
        </div>
        <div className="sort-chips">
          {SORT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              className={`sort-chip${sortMode === opt.value ? ' active' : ''}`}
              onClick={() => { setSortMode(opt.value); setListKey(k => k + 1) }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="exercise-list">
        <div key={listKey}>
        {catalog.length === 0 && (
          <p className="exercise-empty">No presets logged yet.</p>
        )}
        {catalog.map(entry => (
          <div key={entry.norm} className="exercise-item-wrap preset-item-wrap">
            {/* Main row */}
            <div className="exercise-item">
              <div className="ex-row-left">
                <span className="ex-name">#{entry.displayName}</span>
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
          </div>
        ))}
        </div>
      </div>

      {/* Dropdown — portalled to escape overflow clipping */}
      {dropdownEntry && createPortal(
        <div
          className="ex-dropdown"
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
            <button className="ex-dropdown-item" onClick={() => setRenamingFor(dropdownEntry.norm)}>
              rename
            </button>
          )}

          {/* Delete — two-step with mode selection */}
          {deleteConfirmFor === dropdownEntry.norm ? (
            <div className="ex-dropdown-confirm preset-delete-confirm">
              <span className="ex-dropdown-confirm-label">
                {deleteMode === 'label-only'
                  ? 'Remove preset label only?'
                  : 'Remove preset + exercises?'}
              </span>
              <div className="ex-dropdown-confirm-actions">
                <button className="delete-yes-btn" onClick={() => handleDelete(dropdownEntry.norm, deleteMode!)}>
                  Remove
                </button>
                <button className="delete-no-btn" onClick={() => { setDeleteConfirmFor(null); setDeleteMode(null) }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="preset-delete-options">
              <button
                className="ex-dropdown-item ex-dropdown-delete"
                onClick={() => { setDeleteConfirmFor(dropdownEntry.norm); setDeleteMode('label-only') }}
              >
                delete label only
              </button>
              <button
                className="ex-dropdown-item ex-dropdown-delete"
                onClick={() => { setDeleteConfirmFor(dropdownEntry.norm); setDeleteMode('with-exercises') }}
              >
                delete with exercises
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
