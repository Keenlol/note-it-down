import { useState } from 'react'
import { Check } from 'lucide-react'
import {
  ACCENT_COLORS, type AccentKey, getSavedAccent, saveAndApplyAccent,
  type WeightUnit, getSavedWeightUnit, saveWeightUnit,
} from '../utils/settings'
import { tap } from '../utils/tap'

interface Props {
  open: boolean
  onClose: () => void
  height?: number
  onAccentChange?: (key: AccentKey) => void
  onWeightUnitChange?: (unit: WeightUnit) => void
}

export function SettingsSheet({ open, onClose, height, onAccentChange, onWeightUnitChange }: Props) {
  const [accent, setAccent]         = useState<AccentKey>(() => getSavedAccent())
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(() => getSavedWeightUnit())

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
        {/* Weight unit */}
        <div className="settings-section">
          <span className="settings-section-label">Default weight unit</span>
          <p className="settings-section-hint">
            Applied to entries with no explicit unit. Explicit kg/lbs always win.
          </p>
          <div className="unit-toggle">
            <button
              className={`unit-toggle-btn${weightUnit === 'kg' ? ' active' : ''}`}
              onPointerDown={tap}
              onClick={() => handleWeightUnit('kg')}
            >kg</button>
            <button
              className={`unit-toggle-btn${weightUnit === 'lbs' ? ' active' : ''}`}
              onPointerDown={tap}
              onClick={() => handleWeightUnit('lbs')}
            >lbs</button>
          </div>
        </div>

        {/* Accent color */}
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
      </div>
    </div>
  )
}
