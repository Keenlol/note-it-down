import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'
import { migratePresetNotes } from './utils/migrations'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
}

migratePresetNotes()

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
