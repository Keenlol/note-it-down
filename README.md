# note-it-down

A minimal workout tracker that feels like a notes app. No forms, no dropdowns — just type your exercises like you'd jot them down, and the app figures out the rest.

---

## How it works

Type each exercise as a single line. The parser reads the numbers and figures out what they mean:

```
bench press 60 4 10
squat 100 3 8
pushup 3 20
```

**Format:** `exercise name  weight  sets  reps`

- Numbers with `kg` or `lbs` → weight
- `3x10`, `10x3` → sets × reps pair
- `4 10` (two bare numbers, no weight) → bodyweight exercise, sets × reps
- Bodyweight is assumed at 60 kg for volume calculations

Units are flexible — you can write `60kg`, `60`, `132lbs`. Sets and reps can be labeled (`3s 10r`) or positional.

---

## Features

### Smart autocomplete
As you type, the app suggests completions based on your past workouts — matching the most relevant day by how many exercises overlap with what you've already typed today. Press **Tab** or **Enter** to confirm.

If you type a note label (like `push day`) that matches a past session, the whole exercise block from that session is suggested at once.

### Trend indicators
Each exercise line shows how it compares to the last time you did it — green arrows for improvement, red for decline, across weight, reps, and sets.

### Workout heatmap
A 21-week heatmap at the top shows your training history. Cell colour is proportional to total volume (weight × reps × sets) for that day. Tap any cell to view and edit that day's note.

### Reveal mode
Hold the eye button (bottom-right) to see your logged numbers formatted as human-readable values inline:

```
bench press  60kg  10reps x 4sets
```

Numbers stay full orange; units fade to 40% so your eye goes straight to the values.

### New exercise detection
The first time an exercise name appears (not seen in any past session), a subtle `New exercise!` tag shows on the right of that line.

### Swipe navigation
Swipe left/right to move between days. The header and note fade and slide with the gesture.

### PWA
Installable as a home screen app. All data is stored locally in `localStorage` — no account, no server, no sync.

---

## Tech

- **React 19** + **TypeScript** + **Vite 8**
- Custom tokenizer/parser for the exercise format
- Overlay + transparent textarea technique for syntax highlighting
- Local storage only — your data stays on your device

---

## Dev

```bash
npm install
npm run dev
```

---

*Design by Keen :P, code by Claude*
