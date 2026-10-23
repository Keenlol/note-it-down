import { useRef, useState, useMemo, useEffect } from 'react'
import {
  Check, Download, Upload, Trash2, AlertTriangle, ExternalLink,
  ClipboardCopy, FileDown,
} from 'lucide-react'
import {
  ACCENT_COLORS, type AccentKey, getSavedAccent, saveAndApplyAccent,
  type WeightUnit, getSavedWeightUnit, saveWeightUnit,
  getSavedShowDownTrend, saveShowDownTrend,
  getSavedShowQuote, saveShowQuote,
  getSavedLockPast, saveLockPast,
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
import { Sticker } from './Sticker'
import { tap } from '../utils/tap'

const WEIGHT_UNIT_OPTIONS: { value: WeightUnit; label: string }[] = [
  { value: 'kg',  label: 'kg'  },
  { value: 'lbs', label: 'lbs' },
]

type Toggle = 'show' | 'hide'

const SHOW_HIDE_OPTIONS: { value: Toggle; label: string }[] = [
  { value: 'show', label: 'Show' },
  { value: 'hide', label: 'Hide' },
]

type OnOff = 'on' | 'off'

const ON_OFF_OPTIONS: { value: OnOff; label: string }[] = [
  { value: 'on',  label: 'On'  },
  { value: 'off', label: 'Off' },
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
  onShowQuoteChange?: (show: boolean) => void
  onLockPastChange?: (lock: boolean) => void
}

export function SettingsSheet({
  open, onClose, height, onResize, onResizeEnd, dataVersion, onDataChange,
  onAccentChange, onWeightUnitChange, onShowDownTrendChange, onShowQuoteChange,
  onLockPastChange,
}: Props) {
  const [accent, setAccent]         = useState<AccentKey>(() => getSavedAccent())
  const [heatRound, setHeatRound]   = useState<number>(() => getSavedHeatRound())
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(() => getSavedWeightUnit())
  const [downTrend, setDownTrend]   = useState<Toggle>(() => getSavedShowDownTrend() ? 'show' : 'hide')
  const [quote, setQuote]           = useState<Toggle>(() => getSavedShowQuote() ? 'show' : 'hide')
  const [lockPast, setLockPast]     = useState<OnOff>(() => getSavedLockPast() ? 'on' : 'off')
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

  function handleDownTrend(v: Toggle) {
    saveShowDownTrend(v === 'show')
    setDownTrend(v)
    onShowDownTrendChange?.(v === 'show')
  }

  function handleQuote(v: Toggle) {
    saveShowQuote(v === 'show')
    setQuote(v)
    onShowQuoteChange?.(v === 'show')
  }

  function handleLockPast(v: OnOff) {
    saveLockPast(v === 'on')
    setLockPast(v)
    onLockPastChange?.(v === 'on')
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
          <span className="sheet-title"><Sticker name="gear" className="sheet-title-icon lit" />Settings</span>
        </div>
      </div>

      <div className="settings-body">

        <div className="settings-group">
          <div className="settings-row">
            <span className="settings-row-label">Accent</span>
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
                  {accent === c.key && <Check size={11} strokeWidth={3} color="#fff" />}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Heatmap corners</span>
            <div className="settings-row-slider">
              <Slider
                value={heatRound}
                min={HEAT_ROUND_MIN}
                max={HEAT_ROUND_MAX}
                defaultValue={HEAT_ROUND_DEFAULT}
                snapWithin={2}
                onChange={handleHeatRound}
                ariaLabel="Heatmap corner rounding"
              />
            </div>
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-row">
            <span className="settings-row-label">Weight unit</span>
            <SegmentedControl options={WEIGHT_UNIT_OPTIONS} value={weightUnit} onChange={handleWeightUnit} />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Downward trends</span>
            <SegmentedControl options={SHOW_HIDE_OPTIONS} value={downTrend} onChange={handleDownTrend} />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Daily message</span>
            <SegmentedControl options={SHOW_HIDE_OPTIONS} value={quote} onChange={handleQuote} />
          </div>
          <div className="settings-row">
            <span className="settings-row-label">Lock past days</span>
            <SegmentedControl options={ON_OFF_OPTIONS} value={lockPast} onChange={handleLockPast} />
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-row">
            <span className="settings-row-label">Data</span>
            <span className="settings-row-value">
              {formatSize(stats.sizeBytes)} · {stats.entryCount} entr{stats.entryCount !== 1 ? 'ies' : 'y'}
            </span>
          </div>

          {confirm.kind === 'none' && (
            <>
              <div className="settings-row">
                <span className="settings-row-label">Backup</span>
                <div className="data-actions">
                  <button className="data-btn" onPointerDown={tap} onClick={handleExport}>
                    <Upload size={14} strokeWidth={2} />
                    Export
                  </button>
                  <button className="data-btn" onPointerDown={tap} onClick={() => fileInputRef.current?.click()}>
                    <Download size={14} strokeWidth={2} />
                    Import
                  </button>
                </div>
              </div>
              <div className="settings-row">
                <span className="settings-row-label">Clear all data</span>
                <button className="data-btn data-btn-danger" onPointerDown={tap} onClick={() => setConfirm({ kind: 'clear' })}>
                  <Trash2 size={14} strokeWidth={2} />
                  Clear
                </button>
              </div>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />

          {/* Import: choose add or replace */}
          {(confirm.kind === 'import' || confirm.kind === 'import-mode') && (
            <div className="data-confirm">
              <p className="data-confirm-title">
                Import {confirm.summary.dayCount} log entr{confirm.summary.dayCount !== 1 ? 'ies' : 'y'}
              </p>
              <p className="data-confirm-hint">
                <strong>Add</strong> merges in. <strong>Replace</strong> overwrites everything.
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
                Deletes every log, exercise, preset and bodyweight entry. Settings stay.
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

        <div className="settings-group">
          <div className="settings-row">
            <span className="settings-row-label">AI report</span>
            <SegmentedControl options={AI_RANGE_OPTIONS} value={aiRange} onChange={handleAiRange} />
          </div>
          <div className="settings-row">
            <span className="settings-row-value">
              {aiStats.sessions === 0
                ? 'Nothing in this range'
                : `${aiStats.sessions} sessions · ${formatTokens(aiStats.tokens)} tokens`}
            </span>
            {aiStats.sessions > 0 && (
              <div className="data-actions">
                <button className="data-btn data-btn-filled" onPointerDown={tap} onClick={handleAiCopy}>
                  {copyState === 'ok'
                    ? <Check size={14} strokeWidth={2} />
                    : <ClipboardCopy size={14} strokeWidth={2} />}
                  {copyState === 'ok' ? 'Copied' : copyState === 'fail' ? 'Failed' : 'Copy'}
                </button>
                <button
                  className="data-btn"
                  onPointerDown={tap}
                  onClick={() => downloadMarkdown(aiReport)}
                  aria-label="Save as Markdown"
                >
                  <FileDown size={14} strokeWidth={2} />
                  .md
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="settings-about">
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
  )
}
