# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server (Vite, hot reload)
npm run build    # tsc + vite build → dist/
npm run preview  # preview the production build locally
```

No test suite — verify features manually in the browser.

## Git workflow

After successfully implementing a feature (when the user accepts it without asking for changes or adjustments), automatically create a git commit on the `main` branch with a concise commit message describing what was added. Stage only relevant source files — not `dist/`. After committing, always state in the response that a commit was made and include the commit message.

**Never push** unless the user explicitly asks. The user handles all `git push` operations.

## Design system

All new UI must follow these tokens and patterns. Do not introduce new values — extend from these.

### Colors

Use CSS variables exclusively — never hardcode these values in new rules.

| Variable        | Value                        | Usage |
|-----------------|------------------------------|-------|
| `--bg`          | `#0d0d0d`                    | Page background |
| `--sheet-shadow`| `#000000`                    | Shadow an open sheet casts up onto the page |
| `--surface-1`   | `#1e1e1e`                    | Outer cards, borders, dividers, sort chips, sheet handle |
| `--surface-2`   | `#131313`                    | Inner card boxes (history, preset exercise lists) |
| `--surface-3`   | `#242424`                    | Elevated surfaces (dropdown menus) |
| `--text`        | `#e8e8e8`                    | Primary text |
| `--text-2`      | `rgba(232,232,232,0.45)`     | Secondary text (past-day title, open chevron) |
| `--text-dim`    | `rgba(232,232,232,0.35)`     | Metadata, labels, ghost text |
| `--text-muted`  | `rgba(232,232,232,0.25)`     | Very subtle text (menu buttons, separators, chevron) |
| `--grey-2`      | `#707070`                    | Solid twin of `--text-2` on `--bg` — icons, idle sticker paper |
| `--grey-dim`    | `#5a5a5a`                    | Solid twin of `--text-dim` — line grip, swap icon |
| `--grey-muted`  | `#444444`                    | Solid twin of `--text-muted` — disabled arrows, ghost ↵ |
| `--accent`      | `#f97316`                    | Numbers, counts, active states |
| `--accent-dim`  | `rgba(249,115,22,0.45)`      | Dimmed accent text (bw hint, reveal units) |
| `--accent-mid`  | `rgba(249,115,22,0.28)`      | Selection/active bg (merge circle) |
| `--accent-tint` | `rgba(249,115,22,0.12)`      | Subtle accent bg (chips, bw hint bg) |
| `--delete`      | `rgba(220,80,80,0.85)`       | Destructive actions |
| `--cell-empty`  | `var(--surface-1)`           | Heatmap empty cell |

**Rule:** avoid opacity-based rgba() for backgrounds and borders. Use solid surface variables instead. Opacity is acceptable only for accent tints (e.g. `rgba(249,115,22,0.15)`) and the `--text-*` scale.

**Icons are never see-through.** A translucent colour (the `--text-*` scale)
or an `opacity` composites each path of an icon on its own, so wherever two
strokes cross the crossing shows brighter. Colour icons with `--grey-*`, the
solid twins of the text scale, and never fade one with `opacity`. Text glyphs
don't overlap, so text keeps the `--text-*` scale.

The one exception to solid borders: `#2e2e2e` is used for input/circle borders that need slight visibility against a `--surface-1` background.

### Typeface

One family, self-hosted in `src/fonts/` (38 KB): `GeneralSans-Variable.woff2`,
a single file covering weights 200–700. `LICENSE-GeneralSans.txt` must stay.
Vite fingerprints the woff2 into `dist/assets` and the `sw-generator` plugin
precaches it, so the app keeps its typography fully offline. **Never load a
font from a CDN here** — it would break the offline install.

| Variable         | Used by |
|------------------|---------|
| `--font-display` | `.title`, `.sheet-title`, `.data-stat-size-value` |
| `--font`         | everything else |
| `--editor-font`  | `.editor-overlay`, `.editor-textarea`, `.ghost-block`, `.trend-abs` |

All three resolve to General Sans — `--editor-font` is `var(--font)`. Keep the
token anyway: the overlay, the textarea, the preset ghost block and the trend
badges have to be set in *exactly* the same font, or the orange highlights
drift off their digits. One name to change means they cannot fall out of step.

### Weight

General Sans is variable (200–700), but **the app is deliberately semibold**:
chrome, names, labels and controls all sit at `--w-ui`, which is also what the
page inherits. Weight is not a general-purpose scale here. The lighter steps
exist for exactly two jobs, listed below — anything else gets `--w-ui`.

| Variable      | Value | Role |
|---------------|-------|------|
| `--w-ui`      | `600` | the default: every control, name and label |
| `--w-display` | `600` | titles and headline stats — larger, not heavier |
| `--w-note`    | `400` | small descriptive text (job 1) |
| `--w-medium`  | `500` | the load figure in a history row (job 2) |
| `--w-editor`  | `400` | the note text and everything overlaying it |

**Job 1 — small descriptive text.** Text that comments on something rather
than being the thing: hints, timestamps, captions, empty states, supporting
counts. One shared selector list above `.settings-row-value` in index.css
carries `--w-note`; add to that list rather than writing the token into a rule
of its own, so the layer stays visible in one place.

**Job 2 — the history row.** `.history-values` ranks one figure against its
context: the load at `--w-ui`, reps × sets at `--w-note`. Every figure keeps
full `--accent` — weight is the only step. Dimming the supporting numbers was
tried and reads as switched off rather than subordinate.

Consequences to keep in mind:

- `html, body` is `--w-ui`, so a new rule that declares no weight comes out
  semibold — which is usually what you want.
- **`<strong>` means brighter, not bolder.** Its surroundings are already
  semibold, so the global `strong, b` rule keeps `font-weight: inherit` and
  lifts the colour to `--text`. (`.data-stat-count strong` is the exception:
  its label is `--w-note`, so the number restates `--w-ui`.)
- `html, body` keeps `font-synthesis-weight: none`. Real cuts exist for every
  step now, so synthesis should never trigger — leaving it off means a bad
  declaration fails visibly instead of being smeared over.
- `font-variant-numeric: tabular-nums` is a **no-op** — the family has no
  `tnum` feature and proportional digits. The rules using it
  (`.history-values`, `.ex-count`, `.about-val`, `.data-stat-size-value`,
  `.bw-node`) are harmless but do not align columns.
- The `font-style: italic` rules still render as **synthetic oblique**: only
  the upright variable file is shipped. `GeneralSans-VariableItalic.woff2`
  from the same kit would fix that at +40 KB.
- `--w-editor` is `400`: the note reads as writing, deliberately lighter than
  the semibold chrome around it. Everything drawn over the note carries it too
  — the ghost block, the trend badges, the new-exercise label — so a decoration
  never comes out heavier than the line it annotates.

### Sizing and tracking

- `--editor-size: 1.0625rem`, which is 17px. Sized to hold the note at the
  optical scale it had in Gambetta, whose x-height was `0.452` of its em
  against General Sans's `0.534`: 1.25rem there is 1.0625rem here. It also
  stays ≥16px, below which iOS zooms the page on focus.
- Tracking tightens as size grows: `-0.03em` at 2.5rem and 1.7rem,
  `-0.02em` on `.title.past`, `-0.015em` at 0.92rem, `normal` in the editor.
  Uppercase micro-labels go positive (`0.04–0.05em`).
- **The editor must stay `letter-spacing: normal`.** `.editor-overlay` and
  `.editor-textarea` have to be pixel-identical or the orange number
  highlights drift off their digits. Any font property there goes on the
  shared rule so both elements get it.
- **`.title.past` is clamped**, not fixed: `"Wednesday, September 24"` is
  272px in General Sans at 1.375rem. It now has the full content width
  (327px at 375px wide) since the Today button moved to the right edge, so
  `clamp(1.2rem, 5.4vw, 1.375rem)` only catches narrower screens.

### Heatmap cell geometry
Cell rounding is user-set, so nothing may hardcode a cell radius.

| Variable        | Where | Meaning |
|-----------------|-------|---------|
| `--heat-round`  | `:root`, from settings | radius as a *percentage number* of the cell (50+ = circle) |
| `--heat-cell`   | each `.heatmap-grid`, measured | cell size in px |
| `--heat-radius` | `.heatmap-cell` | the two multiplied out |
| `--heat-ring`   | `:root` | gap + width of the selection ring (2.5px) |

`--heat-radius` must stay declared on `.heatmap-cell`: a custom property is
substituted where it is declared, so putting the calc on `:root` would bake in
the fallback cell size for every grid. The selection ring is a `::after`, not
an `outline`, so its radius can be set to `--heat-radius + --heat-ring` — the
value that keeps it concentric at every rounding.

### Corner rounding
One scale, taken from the daily-message pill. Never write a raw radius.

| Variable    | Value  | Used by |
|-------------|--------|---------|
| `--r-card`  | `12px` | anything that reads as a surface: cards, buttons, panels, inputs, search, list rows, dropdowns, graph blocks |
| `--r-inner` | `7px`  | a box nested inside a card — see the formula below |
| `--r-chip`  | `6px`  | small things inside a card that would look like lozenges at card size: trend badges, history rows, "new" labels |

Outside the scale on purpose: circles (`50%`), the 4px slider track and 2px
sheet handle (too thin to take a corner), the heatmap cell (user-set, see
above), and the sheet's own `16px 16px 0 0` — it is the container everything
else sits in, so it carries the one larger radius.

### Card / list row pattern
Every list row uses a two-level nested box:

| Layer        | `background`      | `border-radius` | notes                          |
|--------------|-------------------|-----------------|--------------------------------|
| Outer card   | `var(--surface-1)`| `--r-card`      | `padding: 0 5px`, `margin-bottom: 5px`, `overflow: hidden` |
| Inner box    | `var(--surface-2)`| `--r-inner`     | = `--r-card` − padding(5); `margin-bottom: 5px` (creates bottom gap, contained by `overflow:hidden`) |

- Gap between outer edge and inner box: **5px on all four sides**
- `overflow: hidden` on the outer card is mandatory — it prevents `margin-bottom` on the inner box from collapsing through the outer, and clips inner corners cleanly.
- Inner `border-radius` formula: **outer_radius − side_padding** = 12 − 5 = 7px, which is `--r-inner`. Always derive it this way — the segmented control does the same against its own 3px padding.
- Rows separated by `margin-bottom: 5px` (space, not a line/border).

### Row height
```css
.exercise-item { padding: 7px 0 5px; }   /* top 7px, bottom 5px */
```
Keep row padding in this range — don't add extra vertical space.

### Bottom sheet
```css
border-radius: 16px 16px 0 0;
z-index: 20;
```
**Scrolling bodies.** `.sheet-header` has no bottom padding; each scrolling
body (`.exercise-list`, `.preset-body`, `.settings-body`, `.bw-body`) carries
that 12px as `padding-top` instead. All four then mask their top edge with
`linear-gradient(to bottom, transparent, #000 var(--sheet-fade))` from one
shared rule, so content dissolves into the header rather than being cut at
its edge. The mask is on the element's own box, so it holds still while the
content scrolls under it — and the 12px of padding is what it sits over at
rest, which is why that padding has to stay in the body and not the header.

A sheet paints `--bg`, the same colour as the page, so an open sheet casts a
shadow straight up onto it (`box-shadow: 0 -12px 40px 0 var(--sheet-shadow)`)
and that is what sets the two apart — the page itself never changes colour.
A box-shadow rather than a gradient strip, so it follows the rounded top
corners. It is transparent while closed (a parked sheet sits just below the
screen, and its shadow would show as a band along the bottom) and fades in
with the slide; `.app.sheet-snapping` repeats it in its transition list.
Sheets slide up from the bottom. Multiple sheets are mutually exclusive (opening one closes others). Sheet height is measured from `heatmapRef.bottom` to `visualViewport.height` so it fits between the heatmap and the bottom of the screen.

### Stickers
The bar and the sheet headers use hand-drawn sticker icons (`Sticker.tsx`):
`scale`, `dumbbell`, `tag`, `eyes`, `gear`. Each is drawn once as a list of
pieces and rendered twice: a **cut** layer strokes every piece fat in the
paper colour (the die-cut border, so it always hugs the drawing), then the
**art** layer draws the pieces at their real fills with an ink outline.

| Variable          | Default                 | Role |
|-------------------|-------------------------|------|
| `--sticker-paper` | `--text`                | the sticker and its border |
| `--sticker-ink`   | `--bg`                  | line art — reads as cut through |
| `--sticker-spot`  | paper; `--accent` when lit | the one accent detail |

`.sticker.lit` turns the spot on. A new icon is a new entry in `PIECES`: draw
in the 32-unit box, keep about 4 units clear of the edge for the border, give
exactly one piece `fill: 'spot'`, and tilt it a little if it reads stiff.
Small inline controls (grip, swap, arrows, chevrons) stay lucide line icons:
at 13–16px a sticker border turns to mush.

### Bottom bar buttons
Stickers at 30px. Idle buttons print the sticker on solid grey paper, never a
faded one — with opacity the cut layer shows through the art wherever they
overlap:
```css
.bottom-icon                     { --sticker-paper: var(--grey-2); }   /* idle */
.bottom-btn.active .bottom-icon  { --sticker-paper: var(--text); --sticker-spot: var(--accent); }
/* gradient background for separation from content below */
background: linear-gradient(to top, var(--bg) 62%, transparent);
```
They also opt out of the shared `.tapping` squish, and they animate on
**release**, not press: a finger covers the button while it is down, so a
bounce played on press is over before anyone can see it. They take
`press` / `release` / `cancelPress` from `utils/tap.ts` (bundled as
`pressPop` in App) instead of `tap`. Held, `.pressing` squashes the sticker to
0.8 with a twist; on release `.tapping` runs `sticker-pop` from that squash,
overshooting to 1.2 on the same spring the daily message pops on.
`.bottom-btn.tapping` sets `animation: none` — two nested scale animations
would fight.

### Bottom strip
`.bottom-strip` is its own fixed strip above the icon row, and a **sibling**
of `.bottom-bar`, not a child: at `z-index: 10` it passes under an open sheet
(20) while the bar stays above at 30. A child could never do that — the bar's
own z-index would carry it along. Both strips are `pointer-events: none` with
only their contents re-enabling, so their gradients can't swallow taps meant
for the note. `.content` reserves `104px` for the pair, and `144px`
(`.strip-tall`) when the day nav and the message are both up.

It stacks two rows: the **day nav** (`DayNav.tsx`) over the **daily message**.
The nav centres `‹ #preset ›` and `Today →` as one group. `Today →` shows on
past days only, in `--accent-tint` — it replaced the old right-edge tab. The
preset pill follows the block the cursor is in (the first block when the cursor
is above every header), and shows only once that preset exists on another day.
Its arrows step through `presetDayIndex()` with no wrap-around: an end arrow is
disabled. A step pins the preset (`navPreset` in App) so a landing day holding
several presets keeps the one being followed; any cursor move releases it.

### Daily message

The phrase does **not** flip on logged exercises: a preset drops a whole
session in at once, which says it was planned, not trained. Finishing is a
700 ms hold on the message (`done_YYYY-MM-DD` in localStorage, so it clears
itself at midnight); holding again undoes it. The hold is inert on a day with
no note text at all.

Three animations, on two elements on purpose:

| Class | Element | Plays |
|-------|---------|-------|
| `encouragement-in` / `-pop` | `.encouragement-anim` | on state change, via `key` |
| `encouragement-charge` | `.encouragement-msg.holding` | the wind-up, `--hold-ms` long |
| `confetti-x` / `-y` | portalled `.confetti` | on finish |

Keeping the entry animation off the button matters: removing `.holding` sets
the button's `animation-name` to `none` rather than swapping it, and a swap
would restart whatever the button had been animating before the hold.
`--hold-ms` (index.css) and `HOLD_MS` (Encouragement.tsx) must stay in step.
The confetti is portalled to `<body>` so the burst covers the sheets, which the
strip itself deliberately sits under.

### Line blocks
The note is still **one textarea** — blocks are a layer over it, never separate
inputs, so typing, paste and multi-line selection stay native. Each overlay
line span carries `data-line={i}`, and `measureLines()` reads the real box of
every logical line from those spans, so a wrapped line is still one block.

- `.line-grip` (GripVertical, `--grey-dim`) sits in the page's left padding at
  `left: -22px`, outside the text column, so the note's layout never shifts.
  It shows on the caret's line while the textarea has focus, or on the hovered
  line with a mouse; never on a blank line, in reveal, or read-only.
- Dragging a line moves it; dragging a `#` header moves its whole preset (up to
  the next header, minus trailing blanks). A preset that was set apart with
  blank lines stays set apart where it lands, and the hole it leaves closes.
- While dragging: the source lines fade (`.line-lifted`), a `--surface-1` copy
  follows the finger (`.line-ghost`), a 2px accent `.line-drop` marks the gap,
  and suggestion ghosts are hidden. Nothing drops past the empty line after a
  trailing newline.
- The grip picks up the line under the press, not the one state last pointed
  it at, and stays mounted through the drag because it holds the pointer
  capture. It stops touch propagation so the day swipe and history pull never
  see a drag, and `preventDefault`s the press so the keyboard stays up.
- **Swap** needs no summoning: while the note has focus and the caret sits on
  an exercise line, a bare `ArrowLeftRight` icon (`.line-swap`, `--grey-dim`)
  rides just past the end of that line's text — measured off its last glyph by
  `lineEnd()`, not pinned to the right edge — and is held inside the column
  when a line runs long. It steps aside for an inline suggestion on that line,
  during a drag, in reveal and read-only. A tap on the grip does nothing.

### Swap picker
`SwapSheet.tsx` is the exercise sheet as a one-tap picker. It reuses the sheet
and row classes, but has no sort, merge, menus or history. A row tap swaps and
closes.

- Order: exercises ever logged under the line's preset first ("In #upper"),
  then everything else, each by use count. Exercises already on the day sink
  to the end of their group, with their names held back at `--text-2`.
- Each row previews, in accent, the numbers the swap will bring
  (`lastLinesBefore`): the exercise's latest line before the viewed day. A swap
  writes that line in whole. With no earlier line, it renames the exercise and
  keeps the swapped line's own numbers.
- Opening it blurs the note and sizes the sheet to start just under the note
  (`swapHeight`, never the shared `sheetHeight`), so the line — shaded by
  `.line-mark` for as long as the picker is up — stays in
  view. It counts as an open sheet everywhere the others do, closes when the
  viewed day changes, and a drag on its handle below 240px closes it.

### Ghost / suggestion text
```css
color: var(--text-dim);   /* inline ghost suffix */
```
Preset ghost blocks float absolutely below the triggering line using `top: calc(N * var(--editor-lh) * 1em)`.

### Sheet header
Every sheet titles itself with its own bottom-bar sticker, then the name:
```tsx
<span className="sheet-title">
  <Sticker name="dumbbell" className="sheet-title-icon lit" />Exercises
</span>
```
`scale` bodyweight · `dumbbell` exercises and swap · `tag` presets · `gear`
settings — the same sticker the bottom-bar button uses, lit, which is the
state that button wears while its panel is open.

### Typography scale (inside sheets)
```
sheet title:  1.15rem --w-display  --text
row name:     0.92rem --w-ui       --text
meta (date):  0.72rem --w-note     --text-dim
count:        0.72rem --w-ui       --accent
history load: 0.78rem --w-ui       --accent
history reps: 0.78rem --w-note     --accent
chips/buttons 0.75rem --w-ui       --text-2
dropdown:     0.82rem --w-ui
```

## Architecture

Single-page React 19 + TypeScript app, no backend. All data lives in `localStorage`.

**Data flow:**
- `utils/storage.ts` — read/write per-day workout text keyed as `workout_YYYY-MM-DD`
- `utils/parser.ts` — tokenizes and parses each line into `ParsedLine` (exercise name, weight, sets, reps, highlights). The parser is the core of the app; everything else derives from it.
- `utils/exercises.ts` — aggregates parsed data across days; `buildCatalog`, `getExerciseHistory`, `getDayVolume`, merge/delete helpers.
- `utils/presets.ts` — scans days for `#`-prefixed headers; `buildPresetCatalog`, rename/delete-label/delete-with-exercises.
- `utils/bodyweight.ts` — stores/retrieves bodyweight entries; used to compute volume for bodyweight exercises.
- `utils/aliases.ts` — user-defined exercise name aliases (e.g. "bp" → "bench press").

**Components:**
- `App.tsx` — all state: current text, view date (null = today), suggestions, save status, sheet open state. Handles swipe navigation, keyboard navigation, debounced auto-save (400 ms), and bodyweight extraction.
- `components/Editor.tsx` — textarea with overlay for syntax highlighting (orange numbers) and inline ghost text. Renders trend indicators (↑↓), "New exercise!" badges, and bodyweight hint per line.
- `components/Heatmap.tsx` — 21-week grid; cell color = volume (reps × sets). Clicking a cell sets `viewDate` in App.
- `components/ExerciseSheet.tsx` — bottom sheet: exercise catalog with sort, merge mode, per-exercise expandable history, nickname/delete dropdown.
- `components/PresetSheet.tsx` — bottom sheet: preset catalog with sort, always-visible exercise list per preset, rename/delete-label/delete-with-exercises dropdown.

## Settings patterns

### Row layout
One setting per line — the name on the left, its control on the right. **No
explanatory hints**: if a setting needs a paragraph, rethink the setting.
Related rows share a `settings-group`; groups are set apart by space alone.
```tsx
<div className="settings-group">
  <div className="settings-row">
    <span className="settings-row-label">Setting name</span>
    <SegmentedControl options={...} value={...} onChange={...} />
  </div>
</div>
```
- Row: `min-height: 44px`, label `0.92rem` `--text` (the row-name scale)
- A read-only value takes the control's place as `.settings-row-value`
  (`0.75rem`, `--text-dim`, `--w-note`)
- In a row a segmented control is `--seg-n × 50px` wide, so the two-way
  switches line up down the right edge; a slider sits in `.settings-row-slider`
- Confirmations (`.data-confirm`) replace the rows they belong to, inside the
  same group

### Segmented control
Use `<SegmentedControl options={...} value={...} onChange={...} />` for any mutually-exclusive setting. Generic over string unions — works for 2+ options. The sliding pill is driven by CSS custom properties (`--seg-n`, `--seg-i`), no JS layout math. Do not hand-roll toggles.

```tsx
const OPTIONS: { value: MyType; label: string }[] = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
]
<SegmentedControl options={OPTIONS} value={current} onChange={setCurrent} />
```

### Slider
Use `<Slider>` for a continuous setting — the counterpart to SegmentedControl.
```tsx
<Slider
  value={v} min={0} max={60}
  defaultValue={24} snapWithin={2}      /* marks the default; taps back to it */
  minLabel="Square" maxLabel="Circle"    /* optional; omit both for a bare track */
  onChange={setV}
/>
```
Without end labels there is no legend, so the "default" caption goes too —
the notch and the snap still mark the default. Settings rows use it bare.
Thumb and marker positions are CSS custom properties (`--p`, `--t`), no JS
layout math. Both ride the thumb's travel, inset half a thumb at each end.

### Stat card (prominent value + supporting counts)
Use when a section has one headline metric and several supporting counts.
```tsx
<div className="data-stat-card">
  <div className="data-stat-size">
    <span className="data-stat-size-value">{bigValue}</span>
    <span className="data-stat-size-label">label</span>
  </div>
  <div className="data-stat-counts">
    <span className="data-stat-count"><strong>{n}</strong> things</span>
  </div>
</div>
```
- Headline: `1.6rem weight-700`, `--text`
- Sub-label: `0.68rem uppercase`, `--text-muted`
- Counts: `0.72rem`, label `--text-dim`, number `--text-2 weight-600`

### Action buttons
```tsx
<button className="data-btn" onPointerDown={tap} onClick={...}>
  <Icon size={14} strokeWidth={2} /> Label
</button>
```
Variants: `data-btn` (neutral), `data-btn-danger` (destructive, `--delete`), `data-btn-ghost` (no background). Group them in `<div className="data-actions">`.

### Inline confirmation flow
Never use `window.confirm()`. Confirmation replaces the action buttons inline:
```tsx
type ConfirmState = { kind: 'none' } | { kind: 'my-action' } | { kind: 'import'; data: ... }
const [confirm, setConfirm] = useState<ConfirmState>({ kind: 'none' })

{confirm.kind === 'none' && (
  <div className="data-actions">
    <button className="data-btn data-btn-danger" onClick={() => setConfirm({ kind: 'my-action' })}>
      Dangerous action
    </button>
  </div>
)}

{confirm.kind === 'my-action' && (
  <div className="data-confirm">
    <p className="data-confirm-title">Are you sure?</p>
    <p className="data-confirm-hint">Explain consequences. Be specific.</p>
    <div className="data-confirm-actions">
      <button className="data-btn data-btn-danger" onClick={handleConfirm}>Confirm</button>
      <button className="data-btn data-btn-ghost" onClick={() => setConfirm({ kind: 'none' })}>Cancel</button>
    </div>
  </div>
)}
```
- Confirmation card: `background: --surface-1`, `border-radius: --r-card`, `padding: 12px 14px`
- Title: `0.82rem weight-600`, `--text`
- Hint: `0.72rem`, `--text-dim`, `line-height: 1.5`
- Always offer a Cancel alongside the destructive confirm

**Key patterns:**
- `viewDate === null` means "today"; non-null means browsing a past day. The same `Editor` component handles both — past mode reads/writes `pastText` and suggests from `daysBeforeView` (all days strictly before `viewDate`).
- Suggestions (`getHashPresetSuggestion`, `getSuggestion` in App.tsx) are pure functions over `ParsedDay[]` (newest-first). `#` lines trigger preset ghost: bare `#` → show all, partial → narrow (multi = hint, single = fill).
- `parseLine(line, bodyweightKg?)` is the single source of truth for interpreting any line. Volume is `reps × sets`.
- Exercise name normalization: `normalizeName` lowercases and strips spaces — "Bench Press" === "benchpress".
- Preset name normalization: strip leading `#` and surrounding spaces, then lowercase — `"#home"`, `"# home"`, `"# Home"` all resolve to `"home"`.
