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
| `--surface-1`   | `#1e1e1e`                    | Outer cards, borders, dividers, sort chips, sheet handle |
| `--surface-2`   | `#131313`                    | Inner card boxes (history, preset exercise lists) |
| `--surface-3`   | `#242424`                    | Elevated surfaces (dropdown menus) |
| `--text`        | `#e8e8e8`                    | Primary text |
| `--text-2`      | `rgba(232,232,232,0.45)`     | Secondary text (past-day title, open chevron) |
| `--text-dim`    | `rgba(232,232,232,0.35)`     | Metadata, labels, ghost text |
| `--text-muted`  | `rgba(232,232,232,0.25)`     | Very subtle text (menu buttons, separators, chevron) |
| `--accent`      | `#f97316`                    | Numbers, counts, active states |
| `--accent-dim`  | `rgba(249,115,22,0.45)`      | Dimmed accent text (bw hint, reveal units) |
| `--accent-mid`  | `rgba(249,115,22,0.28)`      | Selection/active bg (merge circle) |
| `--accent-tint` | `rgba(249,115,22,0.12)`      | Subtle accent bg (chips, bw hint bg) |
| `--delete`      | `rgba(220,80,80,0.85)`       | Destructive actions |
| `--cell-empty`  | `var(--surface-1)`           | Heatmap empty cell |

**Rule:** avoid opacity-based rgba() for backgrounds and borders. Use solid surface variables instead. Opacity is acceptable only for accent tints (e.g. `rgba(249,115,22,0.15)`) and the `--text-*` scale.

The one exception to solid borders: `#2e2e2e` is used for input/circle borders that need slight visibility against a `--surface-1` background.

### Card / list row pattern
Every list row uses a two-level nested box:

| Layer        | `background`      | `border-radius` | notes                          |
|--------------|-------------------|-----------------|--------------------------------|
| Outer card   | `var(--surface-1)`| `8px`           | `padding: 0 5px`, `margin-bottom: 5px`, `overflow: hidden` |
| Inner box    | `var(--surface-2)`| `3px`           | = outer(8) − padding(5); `margin-bottom: 5px` (creates bottom gap, contained by `overflow:hidden`) |

- Gap between outer edge and inner box: **5px on all four sides**
- `overflow: hidden` on the outer card is mandatory — it prevents `margin-bottom` on the inner box from collapsing through the outer, and clips inner corners cleanly.
- Inner `border-radius` formula: **outer_radius − side_padding** = 8 − 5 = 3px. Always derive it this way.
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
Sheets slide up from the bottom. Multiple sheets are mutually exclusive (opening one closes others). Sheet height is measured from `heatmapRef.bottom` to `visualViewport.height` so it fits between the heatmap and the bottom of the screen.

### Bottom bar buttons
```css
color: #5c5c5c;            /* idle — solid, avoids SVG path-overlap artifact with rgba */
color: var(--text);        /* hover / active / sheet open */
/* gradient background for separation from content below */
background: linear-gradient(to top, var(--bg) 55%, transparent);
```

### Ghost / suggestion text
```css
color: var(--text-dim);   /* inline ghost suffix */
```
Preset ghost blocks float absolutely below the triggering line using `top: calc(N * var(--editor-lh) * 1em)`.

### Typography scale (inside sheets)
```
title:        1.1rem  weight 600
row name:     0.92rem weight 500
meta (date):  0.72rem color var(--text-dim)
count:        0.72rem color var(--accent)
inner text:   0.78rem color var(--text-dim)
dropdown:     0.82rem
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

### Section layout
Every settings section uses this structure:
```tsx
<div className="settings-section">
  <span className="settings-section-label">Section title</span>
  <p className="settings-section-hint">Optional one-liner explaining behaviour.</p>
  {/* control */}
</div>
```
- Label: `0.72rem`, `font-weight: 600`, uppercase, `--text-dim`
- Hint: `0.7rem`, `--text-muted`, `line-height: 1.5`, `margin-top: -6px`

### Segmented control
Use `<SegmentedControl options={...} value={...} onChange={...} />` for any mutually-exclusive setting. Generic over string unions — works for 2+ options. The sliding pill is driven by CSS custom properties (`--seg-n`, `--seg-i`), no JS layout math. Do not hand-roll toggles.

```tsx
const OPTIONS: { value: MyType; label: string }[] = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
]
<SegmentedControl options={OPTIONS} value={current} onChange={setCurrent} />
```

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
- Confirmation card: `background: --surface-1`, `border-radius: 10px`, `padding: 12px 14px`
- Title: `0.82rem weight-600`, `--text`
- Hint: `0.72rem`, `--text-dim`, `line-height: 1.5`
- Always offer a Cancel alongside the destructive confirm

**Key patterns:**
- `viewDate === null` means "today"; non-null means browsing a past day. The same `Editor` component handles both — past mode reads/writes `pastText` and suggests from `daysBeforeView` (all days strictly before `viewDate`).
- Suggestions (`getHashPresetSuggestion`, `getSuggestion` in App.tsx) are pure functions over `ParsedDay[]` (newest-first). `#` lines trigger preset ghost: bare `#` → show all, partial → narrow (multi = hint, single = fill).
- `parseLine(line, bodyweightKg?)` is the single source of truth for interpreting any line. Volume is `reps × sets`.
- Exercise name normalization: `normalizeName` lowercases and strips spaces — "Bench Press" === "benchpress".
- Preset name normalization: strip leading `#` and surrounding spaces, then lowercase — `"#home"`, `"# home"`, `"# Home"` all resolve to `"home"`.
