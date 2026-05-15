# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # start dev server (Vite, hot reload)
npm run build    # tsc + vite build → dist/
npm run preview  # preview the production build locally
```

No test suite — verify features manually in the browser.

## Auto-commit on feature completion

After successfully implementing a feature (when the user accepts it without asking for changes or adjustments), automatically create a git commit on the `main` branch with a concise commit message describing what was added. Stage only relevant source files — not `dist/`. After committing, always state in the response that a commit was made and include the commit message.

## Architecture

Single-page React 19 + TypeScript app, no backend. All data lives in `localStorage`.

**Data flow:**
- `utils/storage.ts` — read/write per-day workout text keyed as `workout_YYYY-MM-DD`
- `utils/parser.ts` — tokenizes and parses each line into `ParsedLine` (exercise name, weight, sets, reps, highlights). The parser is the core of the app; everything else derives from it.
- `utils/exercises.ts` — aggregates parsed data across days (volume per day per exercise)
- `utils/bodyweight.ts` — stores/retrieves bodyweight entries; used to compute volume for bodyweight exercises
- `utils/aliases.ts` — user-defined exercise name aliases (e.g. "bp" → "bench press")

**Components:**
- `App.tsx` — all state lives here: current text, view date (null = today), suggestions, save status, sheet open state. Handles swipe navigation, keyboard navigation, and debounced auto-save (400 ms).
- `components/Editor.tsx` — textarea with overlay for syntax highlighting (orange numbers) and inline suggestion ghost text. Renders trend indicators (↑↓) and "New exercise!" tags per line.
- `components/Heatmap.tsx` — 21-week grid; cell color = volume (reps × sets). Clicking a cell sets `viewDate` in App.
- `components/ExerciseSheet.tsx` — bottom sheet listing all logged exercises with alias management and per-exercise history.

**Key patterns:**
- `viewDate === null` means "today"; non-null means browsing a past day. The same `Editor` component handles both — past mode reads/writes `pastText` state and suggests only from the day immediately prior.
- Suggestions (`getSuggestion`, `getPresetSuggestion` in App.tsx) are pure functions over `ParsedDay[]` (newest-first). A note label matching a past session triggers a full preset block suggestion.
- `parseLine(line, bodyweightKg?)` is the single source of truth for interpreting any line. Volume is `reps × sets` (not weight × reps × sets) — weight-based volume is not used for coloring.
- Exercise name normalization: `normalizeName` lowercases and strips spaces, so "Bench Press" === "benchpress".
