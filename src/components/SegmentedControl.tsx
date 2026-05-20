import { tap } from '../utils/tap'

export interface SegOption<T extends string> {
  value: T
  label: string
}

interface Props<T extends string> {
  options: SegOption<T>[]
  value: T
  onChange: (value: T) => void
}

export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  const activeIndex = options.findIndex(o => o.value === value)

  return (
    <div
      className="seg-control"
      style={{ '--seg-n': options.length, '--seg-i': activeIndex } as React.CSSProperties}
    >
      {/* Sliding indicator — moves via CSS custom properties, no JS layout needed */}
      <div className="seg-indicator" aria-hidden="true" />
      {options.map(opt => (
        <button
          key={opt.value}
          className={`seg-btn${value === opt.value ? ' active' : ''}`}
          onPointerDown={tap}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
