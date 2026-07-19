import { describe, expect, it } from 'vitest'
import { clearStorageKeys, extractHashedAssetRefs, missingAssetRefs, safeStorageGet, safeStorageRemove, safeStorageSet, type StorageAdapter } from './reliability'

describe('production reliability', () => {
  it('contains browsers that deny local storage', () => {
    const denied: StorageAdapter = {
      getItem: () => { throw new DOMException('blocked', 'SecurityError') },
      setItem: () => { throw new DOMException('blocked', 'SecurityError') },
    }
    expect(safeStorageGet(denied, 'project')).toBeNull()
    expect(safeStorageSet(denied, 'project', '{}')).toBe(false)
    expect(safeStorageGet(null, 'project')).toBeNull()
  })

  it('reads and writes through available storage', () => {
    const values = new Map<string, string>()
    const storage: StorageAdapter = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
    }
    expect(safeStorageSet(storage, 'project', '{"ok":true}')).toBe(true)
    expect(safeStorageGet(storage, 'project')).toBe('{"ok":true}')
  })

  it('clears legacy editable projects without exposing their contents', () => {
    const values = new Map([['project:a', 'old edit'], ['project:b', 'old edit'], ['unrelated', 'keep']])
    const storage: StorageAdapter = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
      removeItem: (key) => { values.delete(key) },
    }
    expect(clearStorageKeys(storage, ['project:a', 'project:b'])).toBe(2)
    expect(values.has('project:a')).toBe(false)
    expect(values.has('project:b')).toBe(false)
    expect(values.get('unrelated')).toBe('keep')
    expect(safeStorageRemove(null, 'project:a')).toBe(false)
  })

  it('extracts both stale and current Vite assets from cached HTML', () => {
    const stale = '<link href="/n9nes9-chipvault/assets/index-u18Q126i.css"><script src="/n9nes9-chipvault/assets/index-pLxO6WMF.js"></script>'
    const current = '<script src="/n9nes9-chipvault/assets/index-current.js?build=4"></script><link href="/n9nes9-chipvault/assets/index-current.css">'
    const required = [...extractHashedAssetRefs(stale), ...extractHashedAssetRefs(current)]
    expect(required).toEqual([
      'assets/index-u18Q126i.css',
      'assets/index-pLxO6WMF.js',
      'assets/index-current.js',
      'assets/index-current.css',
    ])
    expect(missingAssetRefs(required, required)).toEqual([])
    expect(missingAssetRefs(required, extractHashedAssetRefs(current))).toEqual([
      'assets/index-u18Q126i.css',
      'assets/index-pLxO6WMF.js',
    ])
  })
})
