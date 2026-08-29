import { useRef, useState, useMemo, useEffect } from 'react'
import {
  Check, Download, Upload, Trash2, AlertTriangle, ExternalLink,
  ClipboardCopy, FileDown, Settings as SettingsIcon,
} from 'lucide-react'
import {
  ACCENT_COLORS, type AccentKey, getSavedAccent, saveAndApplyAccent,
  type WeightUnit, getSavedWeightUnit, saveWeightUnit,
  getSavedShowDownTrend, saveShowDownTrend,
  type AiRange, getSavedAiRange, saveAiRange,
  HEAT_ROUND_MIN, HEAT_ROUND_MAX, HEAT_ROUND_DEFAULT,
  getSavedHeatRound, saveAndApplyHeatRound,
} from '../utils/settings'
import {
  getDataStats, formatSize, exportData, parseImportFile, applyImport,
  clearData, type ImportSummary,
} from '../utils/data'
import {
  buildAiExport, aiExportStats, formatTokens, copyText, downloadMarkdown,
} from '../utils/aiExport'
import { SegmentedControl } from './SegmentedControl'
import { Slider } from './Slider'
import { SheetHandle } from './SheetHandle'
import { tap } from '../utils/tap'

const WEIGHT_UNIT_OPTIONS: { value: WeightUnit; label: string }[] = [
  { value: 'kg',  label: 'kg'  },
  { value: 'lbs', label: 'lbs' },
]

type DownTrend = 'show' | 'hide'

const DOWN_TREND_OPTIONS: { value: DownTrend; label: string }[] = [
  { value: 'show', label: 'Show' },
  { value: 'hide', label: 'Hide' },
]

const AI_RANGE_OPTIONS: { value: AiRange; label: string }[] = [
  { value: '1m',  label: '1M'  },
  { value: '3m',  label: '3M'  },
  { value: '1y',  label: '1Y'  },
  { value: 'all', label: 'All' },
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
  onResize: (height: number) => void
  onResizeEnd: () => void
  dataVersion: number
  onDataChange: () => void
  onAccentChange?: (key: AccentKey) => void
  onWeightUnitChange?: (unit: WeightUnit) => void
  onShowDownTrendChange?: (show: boolean) => void
}

export function SettingsSheet({
  open, onClose, height, onResize, onResizeEnd, dataVersion, onDataChange,
  onAccentChange, onWeightUnitChange, onShowDownTrendChange,
}: Props) {
  const [accent, setAccent]         = useState<AccentKey>(() => getSavedAccent())
  const [heatRound, setHeatRound]   = useState<number>(() => getSavedHeatRound())
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(() => getSavedWeightUnit())
  const [downTrend, setDownTrend]   = useState<DownTrend>(() => getSavedShowDownTrend() ? 'show' : 'hide')
  const [confirm, setConfirm]       = useState<ConfirmState>({ kind: 'none' })
  const [aiRange, setAiRange]       = useState<AiRange>(() => getSavedAiRange())
  const [copyState, setCopyState]   = useState<'idle' | 'ok' | 'fail'>('idle')
  const fileInputRef                = useRef<HTMLInputElement>(null)

  const stats = useMemo(
    () => getDataStats(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataVersion],
  )

  // Building the report walks every stored day, so only do it while the sheet
  // is actually open.
  const aiReport = useMemo(
    () => (open ? buildAiExport(aiRange, weightUnit) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, aiRange, weightUnit, dataVersion],
  )
  const aiStats = useMemo(() => aiExportStats(aiReport), [aiReport])

  useEffect(() => {
    if (copyState === 'idle') return
    const t = setTimeout(() => setCopyState('idle'), 1600)
    return () => clearTimeout(t)
  }, [copyState])

  function handleAccent(key: AccentKey) {
    saveAndApplyAccent(key)
    setAccent(key)
    onAccentChange?.(key)
  }

  function handleHeatRound(pct: number) {
    saveAndApplyHeatRound(pct)
    setHeatRound(pct)
  }

  function handleWeightUnit(unit: WeightUnit) {
    saveWeightUnit(unit)
    setWeightUnit(unit)
    onWeightUnitChange?.(unit)
  }

  function handleDownTrend(v: DownTrend) {
    saveShowDownTrend(v === 'show')
    setDownTrend(v)
    onShowDownTrendChange?.(v === 'show')
  }

  function handleExport() {
    exportData()
  }

  function handleAiRange(range: AiRange) {
    saveAiRange(range)
    setAiRange(range)
  }

  async function handleAiCopy() {
    setCopyState(await copyText(aiReport) ? 'ok' : 'fail')
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
      <SheetHandle onClose={onClose} onResize={onResize} onResizeEnd={onResizeEnd} />

      <div className="sheet-header">
        <div className="sheet-title-row">
          <span className="sheet-title"><SettingsIcon className="sheet-title-icon" size={17} strokeWidth={1.8} />Settings</span>
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

        {/* ── Heatmap corners ──────────────────────────────────── */}
        <div className="settings-section">
          <span className="settings-section-label">Heatmap corners</span>
          <p className="settings-section-hint">
            How round each day is in the grid above — it updates as you drag. The last
            stretch of the slider is all circle; the selection ring follows the shape.
          </p>
          <Slider
            value={heatRound}
            min={HEAT_ROUND_MIN}
            max={HEAT_ROUND_MAX}
            defaultValue={HEAT_ROUND_DEFAULT}
            snapWithin={2}
            minLabel="Square"
            maxLabel="Circle"
            onChange={handleHeatRound}
            ariaLabel="Heatmap corner rounding"
          />
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

        {/* ── Downward trends ─────────────────────────────────── */}
        <div className="settings-section">
          <span className="settings-section-label">Downward trends</span>
          <p className="settings-section-hint">
            Badges for lighter or fewer than last time. Hide them if seeing a drop makes
            you want to log something you didn't lift — a deload is training, not a setback.
          </p>
          <SegmentedControl
            options={DOWN_TREND_OPTIONS}
            value={downTrend}
            onChange={handleDownTrend}
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
                <Upload size={14} strokeWidth={2} />
                Export
              </button>
              <button className="data-btn" onPointerDown={tap} onClick={() => fileInputRef.current?.click()}>
                <Download size={14} strokeWidth={2} />
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

        {/* ── Analyse with AI ──────────────────────────────────── */}
        <div className="settings-section">
          <span className="settings-section-label">Analyse with AI</span>
          <p className="settings-section-hint">
            Writes your log as a compact report — totals, per-exercise progress, weekly
            rollup, then every session — with a legend so any AI reads it correctly.
            Paste it into ChatGPT, Claude or anything else. Nothing leaves this device
            on its own; you send it yourself.
          </p>

          <SegmentedControl
            options={AI_RANGE_OPTIONS}
            value={aiRange}
            onChange={handleAiRange}
          />

          {aiStats.sessions === 0 ? (
            <p className="settings-section-hint">Nothing logged in this range yet.</p>
          ) : (
            <>
              <div className="data-stat-counts">
                <span className="data-stat-count"><strong>{aiStats.sessions}</strong> sessions</span>
                <span className="data-stat-count"><strong>{formatTokens(aiStats.tokens)}</strong> tokens</span>
                <span className="data-stat-count"><strong>{formatSize(aiStats.chars)}</strong> of text</span>
              </div>

              <div className="data-actions">
                <button
                  className="data-btn data-btn-filled"
                  onPointerDown={tap}
                  onClick={handleAiCopy}
                >
                  {copyState === 'ok'
                    ? <Check size={14} strokeWidth={2} />
                    : <ClipboardCopy size={14} strokeWidth={2} />}
                  {copyState === 'ok' ? 'Copied' : copyState === 'fail' ? 'Copy failed' : 'Copy report'}
                </button>
                <button
                  className="data-btn"
                  onPointerDown={tap}
                  onClick={() => downloadMarkdown(aiReport)}
                >
                  <FileDown size={14} strokeWidth={2} />
                  Save .md
                </button>
              </div>
            </>
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
