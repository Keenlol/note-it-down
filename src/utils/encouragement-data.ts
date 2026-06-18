// Daily encouragement phrases collected from various AIs.
//
// Two pools:
//   before — shown when today has no logged entries yet ("let's do this")
//   after  — shown once today has at least one exercise logged ("good job")
//
// author === null  → the AI's own words; rendered as a clean message, no attribution.
// author === string → a genuine quote; rendered with "— Author".
//
// To add a batch from another AI, just append its objects to these arrays.
// Source AI is intentionally NOT stored — only real quotes show an author.

export interface Phrase {
  text: string
  kind: 'hype' | 'wise'
  author: string | null
}

export const BEFORE: Phrase[] = [
  // --- Grok ---
  { text: "Let's go — today is YOURS to take.", kind: 'hype', author: null },
  { text: "You vs you. Let's win this round.", kind: 'hype', author: null },
  { text: "Time to move. I'm right here with you.", kind: 'hype', author: null },
  { text: "Get after it. Your future self is watching.", kind: 'hype', author: null },
  { text: "We got this. One rep at a time.", kind: 'hype', author: null },
  { text: "Show up strong. The energy is waiting.", kind: 'hype', author: null },
  { text: "Unlock that power. Let's build something.", kind: 'hype', author: null },
  { text: "You're built for this. Go prove it.", kind: 'hype', author: null },
  { text: "Heart on fire. Let's make today count.", kind: 'hype', author: null },
  { text: "Step up. The couch can wait.", kind: 'hype', author: null },
  { text: "It is not the mountain we conquer but ourselves.", kind: 'wise', author: 'Edmund Hillary' },
  { text: "You miss 100% of the shots you don't take.", kind: 'wise', author: 'Wayne Gretzky' },
  { text: "Small daily improvements create stunning results.", kind: 'wise', author: null },
  { text: "Showing up is how you outpace yesterday.", kind: 'wise', author: null },
  { text: "Effort compounds. Trust the quiet work.", kind: 'wise', author: null },
  { text: "The start is the hardest. Then comes momentum.", kind: 'wise', author: null },
  { text: "Discipline weighs ounces. Regret weighs tons.", kind: 'wise', author: null },
  { text: "Every beginning carries its own promise.", kind: 'wise', author: null },
  { text: "Strength grows the moment you choose to move.", kind: 'wise', author: null },
  { text: "The body achieves what the mind believes.", kind: 'wise', author: 'Napoleon Hill' },
]

export const AFTER: Phrase[] = [
  // --- Grok ---
  { text: "Look at you. That's how it's done.", kind: 'hype', author: null },
  { text: "Hell yes. You just leveled up.", kind: 'hype', author: null },
  { text: "Proud of you. That was all heart.", kind: 'hype', author: null },
  { text: "You showed up and owned it. Legend.", kind: 'hype', author: null },
  { text: "Strong work. Feel that win in your bones.", kind: 'hype', author: null },
  { text: "You did the damn thing. Celebrate it.", kind: 'hype', author: null },
  { text: "That's my teammate. Incredible effort.", kind: 'hype', author: null },
  { text: "You pushed through. Pure fire.", kind: 'hype', author: null },
  { text: "Mission complete. You're unstoppable.", kind: 'hype', author: null },
  { text: "What a session. You earned every bit of this.", kind: 'hype', author: null },
  { text: "The pain of today is the strength of tomorrow.", kind: 'wise', author: null },
  { text: "Progress is hidden in the reps you just finished.", kind: 'wise', author: null },
  { text: "You didn't quit. That's the whole game.", kind: 'wise', author: null },
  { text: "Every workout is a deposit in your future.", kind: 'wise', author: null },
  { text: "It is the hours you put in when no one sees.", kind: 'wise', author: null },
  { text: "You are what you repeatedly do.", kind: 'wise', author: 'Aristotle' },
  { text: "The reward is in the becoming.", kind: 'wise', author: null },
  { text: "You've grown stronger than you realize.", kind: 'wise', author: null },
  { text: "Consistency is quiet confidence in action.", kind: 'wise', author: null },
  { text: "Champions are made in the moments after the decision.", kind: 'wise', author: null },
]
