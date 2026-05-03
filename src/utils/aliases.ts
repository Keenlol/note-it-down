const KEY = 'nid-aliases'

// Stored as { [normalizedFrom]: normalizedTo }
export function loadAliases(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  catch { return {} }
}

export function saveAlias(from: string, to: string): void {
  const a = loadAliases()
  a[from] = to
  localStorage.setItem(KEY, JSON.stringify(a))
}
