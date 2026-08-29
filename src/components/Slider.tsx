import type { CSSProperties } from 'react'

interface Props {
  value: number
  min: number
  max: number
  step?: number
  /** Marked on the track with a notch; its caption taps back to this value. */
  defaultValue?: number
  /** Values within this distance of `defaultValue` snap to it. */
  snapWithin?: number
  /** End captions, e.g. "Square" … "Circle". */
  minLabel?: string
  maxLabel?: string
  onChange: (value: number) => void
  ariaLabel?: string
}

/**
 * Continuous setting control — the slider counterpart to SegmentedControl.
 * The track fill and the default marker ride on two custom properties, `--p`
 * (0…1, where the thumb sits) and `--t` (0…1, where the default sits), so the
 * notch and its caption line up without measuring anything. Both are placed
 * along the thumb's own travel — inset by half a thumb at each end — so the
 * marker sits under the thumb centre rather than drifting toward the edges.
 */
export function Slider({
  value, min, max, step = 1, defaultValue, snapWithin = 0,
  minLabel, maxLabel, onChange, ariaLabel,
}: Props) {
  const frac = (v: number) => (max === min ? 0 : (v - min) / (max - min))
  const hasMark = defaultValue !== undefined

  function handle(raw: number) {
    const snapped = hasMark && Math.abs(raw - defaultValue!) <= snapWithin ? defaultValue! : raw
    if (snapped !== value) onChange(snapped)
  }

  const style = {
    '--p': frac(value),
    ...(hasMark ? { '--t': frac(defaultValue!) } : {}),
  } as CSSProperties

  return (
    <div className="slider" style={style}>
      <div className="slider-row">
        <input
          type="range"
          className="slider-input"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => handle(Number(e.target.value))}
          aria-label={ariaLabel}
        />
        {hasMark && <span className="slider-notch" />}
      </div>

      {(hasMark || minLabel || maxLabel) && (
        <div className="slider-legend">
          <span>{minLabel}</span>
          {/* No `tap` bounce on the caption: it is centred on the marker with a
              translate, and the shared tap keyframe would overwrite it. */}
          {hasMark && (
            <button
              type="button"
              className={`slider-default${value === defaultValue ? ' active' : ''}`}
              onClick={() => handle(defaultValue!)}
            >
              default
            </button>
          )}
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  )
}
