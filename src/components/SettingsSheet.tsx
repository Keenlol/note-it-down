import { useRef, useState, useMemo } from 'react'
import { Check, Download, Upload, Trash2, AlertTriangle, ExternalLink } from 'lucide-react'
import {
  ACCENT_COLORS, type AccentKey, getSavedAccent, saveAndApplyAccent,
  type WeightUnit, getSavedWeightUnit, saveWeightUnit,
} from '../utils/settings'
import {
  getDataStats, formatSize, exportData, parseImportFile, applyImport,
  clearData, type ImportSummary,
} from '../utils/data'
import { SegmentedControl } from './SegmentedControl'
import { tap } from '../utils/tap'

const WEIGHT_UNIT_OPTIONS: { value: WeightUnit; label: string }[] = [
  { value: 'kg',  label: 'kg'  },
  { value: 'lbs', label: 'lbs' },
]

type ConfirmState =
  | { kind: 'none' }
  | { kind: 'clear' }
  | { kind: 'import'; summary: ImportSummary }
  | { kind: 'import-mode'; summary: ImportSummary }  // after choosing replace

interface Props {
  open: boolean
  onClose: () => void
  height?: number
  dataVersion: number
  onDataChange: () => void
  onAccentChange?: (key: AccentKey) => void
  onWeightUnitChange?: (unit: WeightUnit) => void
}

export function SettingsSheet({
  open, onClose, height, dataVersion, onDataChange,
  onAccentChange, onWeightUnitChange,
}: Props) {
  const [accent, setAccent]         = useState<AccentKey>(() => getSavedAccent())
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(() => getSavedWeightUnit())
  const [confirm, setConfirm]       = useState<ConfirmState>({ kind: 'none' })
  const fileInputRef                = useRef<HTMLInputElement>(null)

  const stats = useMemo(
    () => getDataStats(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataVersion],
  )

  function handleAccent(key: AccentKey) {
    saveAndApplyAccent(key)
    setAccent(key)
    onAccentChange?.(key)
  }

  function handleWeightUnit(unit: WeightUnit) {
    saveWeightUnit(unit)
    setWeightUnit(unit)
    onWeightUnitChange?.(unit)
  }

  function handleExport() {
    exportData()
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const summary = parseImportFile(ev.target?.result as string)
        setConfirm({ kind: 'import', summary })
      } catch {
        alert('Invalid backup file.')
      }
    }
    reader.readAsText(file)
    // Reset so the same file can be re-selected
    e.target.value = ''
  }

  function handleImportConfirm(mode: 'add' | 'replace') {
    if (confirm.kind !== 'import' && confirm.kind !== 'import-mode') return
    applyImport(confirm.summary.rawBundle, mode)
    setConfirm({ kind: 'none' })
    onDataChange()
  }

  function handleClearConfirm() {
    clearData()
    setConfirm({ kind: 'none' })
    onDataChange()
  }

  function dismissConfirm() { setConfirm({ kind: 'none' }) }

  return (
    <div
      className={`exercise-sheet${open ? ' open' : ''}`}
      style={height !== undefined ? { height: `${height}px` } : undefined}
    >
      <div className="sheet-handle-wrap" onPointerDown={tap} onClick={onClose}>
        <div className="sheet-handle" />
      </div>

      <div className="sheet-header">
        <div className="sheet-title-row">
          <span className="sheet-title">Settings</span>
        </div>
      </div>

      <div className="settings-body">

        {/* ── Accent color ─────────────────────────────────────── */}
        <div className="settings-section">
          <span className="settings-section-label">Accent color</span>
          <div className="accent-swatches">
            {ACCENT_COLORS.map(c => (
              <button
                key={c.key}
                className={`accent-swatch${accent === c.key ? ' active' : ''}`}
                style={{ background: c.hex }}
                onPointerDown={tap}
                onClick={() => handleAccent(c.key)}
                aria-label={c.label}
                title={c.label}
              >
                {accent === c.key && <Check size={14} strokeWidth={2.5} color="#fff" />}
              </button>
            ))}
          </div>
        </div>

        {/* ── Weight unit ─────────────────────────────────────── */}
        <div className="settings-section">
          <span className="settings-section-label">Default weight unit</span>
          <p className="settings-section-hint">
            Applied to entries with no explicit unit. Explicit kg / lbs always win.
          </p>
          <SegmentedControl
            options={WEIGHT_UNIT_OPTIONS}
            value={weightUnit}
            onChange={handleWeightUnit}
          />
        </div>

        {/* ── Data ─────────────────────────────────────────────── */}
        <div className="settings-section">
          <span className="settings-section-label">Data</span>

          {/* Single stat card: size prominent, counts as supporting info */}
          <div className="data-stat-card">
            <div className="data-stat-size">
              <span className="data-stat-size-value">{formatSize(stats.sizeBytes)}</span>
              <span className="data-stat-size-label">stored</span>
            </div>
            <div className="data-stat-counts">
              <span className="data-stat-count"><strong>{stats.exerciseCount}</strong> exercises</span>
              <span className="data-stat-count"><strong>{stats.presetCount}</strong> presets</span>
              <span className="data-stat-count"><strong>{stats.entryCount}</strong> log entries</span>
            </div>
          </div>

          {/* Action buttons — or inline confirmation */}
          {confirm.kind === 'none' && (
            <div className="data-actions">
              <button className="data-btn" onPointerDown={tap} onClick={handleExport}>
                <Download size={14} strokeWidth={2} />
                Export
              </button>
              <button className="data-btn" onPointerDown={tap} onClick={() => fileInputRef.current?.click()}>
                <Upload size={14} strokeWidth={2} />
                Import
              </button>
              <button className="data-btn data-btn-danger" onPointerDown={tap} onClick={() => setConfirm({ kind: 'clear' })}>
                <Trash2 size={14} strokeWidth={2} />
                Clear
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
            </div>
          )}

          {/* Import: choose add or replace */}
          {(confirm.kind === 'import' || confirm.kind === 'import-mode') && (
            <div className="data-confirm">
              <p className="data-confirm-title">
                Import {confirm.summary.dayCount} log entr{confirm.summary.dayCount !== 1 ? 'ies' : 'y'}
              </p>
              <p className="data-confirm-hint">
                <strong>Add</strong> merges with your current data.{' '}
                <strong>Replace</strong> overwrites everything — export first to be safe.
              </p>
              <div className="data-confirm-actions">
                <button className="data-btn" onPointerDown={tap} onClick={() => handleImportConfirm('add')}>
                  Add
                </button>
                <button className="data-btn data-btn-danger" onPointerDown={tap} onClick={() => handleImportConfirm('replace')}>
                  <AlertTriangle size={13} strokeWidth={2} />
                  Replace
                </button>
                <button className="data-btn data-btn-ghost" onPointerDown={tap} onClick={dismissConfirm}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Clear: confirmation */}
          {confirm.kind === 'clear' && (
            <div className="data-confirm">
              <p className="data-confirm-title">Clear all data?</p>
              <p className="data-confirm-hint">
                This permanently deletes all log entries, exercises, presets, and bodyweight records. Your settings are kept.
              </p>
              <div className="data-confirm-actions">
                <button className="data-btn data-btn-danger" onPointerDown={tap} onClick={handleClearConfirm}>
                  <Trash2 size={13} strokeWidth={2} />
                  Clear everything
                </button>
                <button className="data-btn data-btn-ghost" onPointerDown={tap} onClick={dismissConfirm}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── About ────────────────────────────────────────── */}
        <div className="settings-section">
          <span className="settings-section-label">About</span>
          <div className="about-card">
            <div className="about-row">
              <span className="about-val">v{__APP_VERSION__}</span>
              <span className="about-sep">·</span>
              <span className="about-val">{__BUILD_DATE__}</span>
              <span className="about-sep">·</span>
              <a
                className="about-link"
                href="https://github.com/Keenlol/note-it-down"
                target="_blank"
                rel="noopener noreferrer"
              >
                Keenlol/note-it-down
                <ExternalLink size={11} strokeWidth={2} />
              </a>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
