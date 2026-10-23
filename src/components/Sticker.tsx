import type { ReactElement } from 'react'

export type StickerName = 'scale' | 'dumbbell' | 'tag' | 'eyes' | 'gear'

/**
 * Hand-drawn sticker icons. Each one is drawn once and rendered twice:
 *
 *   cut  — every piece stroked fat in the paper colour, which is the die-cut
 *          border, so it always hugs the drawing's own silhouette;
 *   art  — the same pieces at their real fills, outlined in ink.
 *
 * Three colours, all from CSS: --sticker-paper (the sticker), --sticker-ink
 * (the line art, the page colour so lines read as cut through) and
 * --sticker-spot (one accent detail — paper while idle, so it disappears).
 */

type Fill = 'paper' | 'spot' | 'ink' | 'none'

interface Piece {
  el: ReactElement      // the shape, with no fill or stroke of its own
  fill: Fill
  line?: boolean        // ink outline (default true)
}

const INK = 2.6
const BORDER = 2.6     // die-cut border beyond the ink line

/** A gear outline: `teeth` flat-topped teeth around a root circle. */
function gearPath(cx: number, cy: number, teeth: number, outer: number, root: number): string {
  const pts: string[] = []
  const step = (Math.PI * 2) / teeth
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2
    const at = (r: number, da: number) =>
      `${(cx + r * Math.cos(a + da)).toFixed(2)} ${(cy + r * Math.sin(a + da)).toFixed(2)}`
    pts.push(at(root, -step * 0.5), at(root, -step * 0.27), at(outer, -step * 0.17),
      at(outer, step * 0.17), at(root, step * 0.27))
  }
  return `M${pts.join('L')}Z`
}

// Drawn level, then tilted — and sized up, since a bar reads smaller than a block.
const DUMBBELL = 'rotate(-32 16 16) translate(16 16) scale(1.12) translate(-16 -16)'
const SCALE_TILT = 'rotate(-6 16 16)'

const PIECES: Record<StickerName, Piece[]> = {
  // Bathroom scale, dial window up top, set down a touch crooked.
  scale: [
    { el: <path d="M11.2 6h9.8c3.5 0 6.1 2.5 6 6.2l-.2 8.7c0 3.3-2.7 5.9-6 5.9h-9.9c-3.3.1-5.9-2.6-5.9-5.9V12.3C5 8.8 7.7 6.1 11.2 6z" transform={SCALE_TILT} />, fill: 'paper' },
    { el: <path d="M10.6 15.2c.4-3.3 2.6-5.2 5.5-5.2s5.1 1.9 5.4 5.2z" transform={SCALE_TILT} />, fill: 'spot' },
    { el: <path d="M16 15l2.4-3.4" transform={SCALE_TILT} />, fill: 'none' },
    { el: <path d="M12.5 21.6h7" transform={SCALE_TILT} />, fill: 'none' },
  ],

  // Dumbbell, tilted the way it would be lying on a bench.
  dumbbell: [
    { el: <path d="M8.5 16h15" transform={DUMBBELL} />, fill: 'none' },
    { el: <rect x="4.6" y="12.6" width="3.6" height="6.8" rx="1.5" transform={DUMBBELL} />, fill: 'paper' },
    { el: <rect x="8" y="10.4" width="4.2" height="11.2" rx="1.8" transform={DUMBBELL} />, fill: 'spot' },
    { el: <rect x="19.8" y="10.4" width="4.2" height="11.2" rx="1.8" transform={DUMBBELL} />, fill: 'spot' },
    { el: <rect x="23.8" y="12.6" width="3.6" height="6.8" rx="1.5" transform={DUMBBELL} />, fill: 'paper' },
  ],

  // Luggage tag, point up-left, with its hole and two lines of "label".
  tag: [
    { el: <path d="M13.2 8.3l10.9-.2c1.9 0 3.3 1.4 3.3 3.2l.1 9.6c0 1.8-1.5 3.2-3.3 3.2l-11 .1-7.4-7.9z" transform="rotate(38 16.5 16)" />, fill: 'spot' },
    { el: <circle cx="11.6" cy="16" r="1.7" transform="rotate(38 16.5 16)" />, fill: 'ink', line: false },
    { el: <path d="M16.8 13.6h6.4M16.8 18.4h4.2" transform="rotate(38 16.5 16)" />, fill: 'none' },
  ],

  // Two eyes, glancing to the side.
  eyes: [
    { el: <ellipse cx="10.8" cy="16.3" rx="5.4" ry="7.6" />, fill: 'paper' },
    { el: <ellipse cx="21.6" cy="15.7" rx="5.4" ry="7.6" />, fill: 'paper' },
    { el: <circle cx="12.6" cy="17.4" r="3" />, fill: 'spot', line: false },
    { el: <circle cx="23.4" cy="16.8" r="3" />, fill: 'spot', line: false },
    { el: <circle cx="13.2" cy="17.6" r="1.7" />, fill: 'ink', line: false },
    { el: <circle cx="24" cy="17" r="1.7" />, fill: 'ink', line: false },
  ],

  // Gear, eight teeth, a fat hub.
  gear: [
    { el: <path d={gearPath(16, 16, 8, 11.6, 8.6)} transform="rotate(9 16 16)" />, fill: 'paper' },
    { el: <circle cx="16" cy="16" r="3.8" />, fill: 'spot' },
  ],
}

const FILL: Record<Fill, string> = {
  paper: 'var(--sticker-paper)',
  spot: 'var(--sticker-spot)',
  ink: 'var(--sticker-ink)',
  none: 'none',
}

interface Props {
  name: StickerName
  className?: string
}

export function Sticker({ name, className }: Props) {
  const pieces = PIECES[name]
  return (
    <svg
      className={`sticker${className ? ` ${className}` : ''}`}
      viewBox="-2 -2 36 36"
      aria-hidden="true"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g fill="var(--sticker-paper)" stroke="var(--sticker-paper)" strokeWidth={INK + BORDER * 2}>
        {pieces.map((p, i) => <g key={i}>{p.el}</g>)}
      </g>
      <g stroke="var(--sticker-ink)" strokeWidth={INK}>
        {pieces.map((p, i) => (
          <g key={i} className={p.fill === 'spot' ? 'sticker-spot' : undefined}
            fill={FILL[p.fill]} stroke={p.line === false ? 'none' : undefined}>
            {p.el}
          </g>
        ))}
      </g>
    </svg>
  )
}
