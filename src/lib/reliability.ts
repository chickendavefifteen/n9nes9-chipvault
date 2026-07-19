export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export function safeStorageGet(storage: StorageAdapter | null | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function safeStorageSet(storage: StorageAdapter | null | undefined, key: string, value: string): boolean {
  try {
    if (!storage) return false
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeStorageRemove(storage: StorageAdapter | null | undefined, key: string): boolean {
  try {
    if (!storage?.removeItem) return false
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function clearStorageKeys(storage: StorageAdapter | null | undefined, keys: Iterable<string>): number {
  let removed = 0
  for (const key of keys) {
    if (safeStorageRemove(storage, key)) removed += 1
  }
  return removed
}

export function browserStorage(): StorageAdapter | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function extractHashedAssetRefs(html: string): string[] {
  const refs = [...html.matchAll(/(?:src|href)=["'][^"']*?(assets\/index-[^"'?]+\.(?:js|css))(?:\?[^"']*)?["']/gi)]
    .map((match) => match[1])
  return [...new Set(refs)]
}

export function missingAssetRefs(refs: Iterable<string>, availablePaths: Iterable<string>): string[] {
  const available = new Set(availablePaths)
  return [...new Set(refs)].filter((ref) => !available.has(ref))
}
