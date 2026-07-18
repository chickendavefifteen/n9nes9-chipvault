import { describe, expect, it } from 'vitest'
import {
  createPlaybackSignal,
  isPlaybackSignal,
  shouldRestartSource,
  SOURCE_STALL_GRACE_MS,
  sourceLoopStart,
  sourceNeedsFallback,
  sourceRowPosition,
} from './playback'

describe('playback reliability', () => {
  it('maps recovered source time to its measured fractional row', () => {
    const sync = { audioOffset: 1.5, secondsPerRow: 0.1, loopRows: 128, confidence: 1, evidence: [] }
    expect(sourceRowPosition(2.75, sync, 150, 128)).toBeCloseTo(12.5)
    expect(sourceRowPosition(14.35, sync, 150, 128)).toBeCloseTo(0.5)
    expect(sourceLoopStart(sync)).toBe(1.5)
  })

  it('animates unrecovered drafts from their declared tracker tempo', () => {
    expect(sourceRowPosition(1, undefined, 150, 64)).toBeCloseTo(10)
    expect(sourceRowPosition(6.5, undefined, 150, 64)).toBeCloseTo(1)
    expect(sourceLoopStart(undefined)).toBe(0)
  })

  it('falls back only after a bounded source stall', () => {
    const base = { initialTime: 3, currentTime: 3, paused: false, readyState: 4 }
    expect(sourceNeedsFallback({ ...base, elapsedMs: SOURCE_STALL_GRACE_MS - 1 })).toBe(false)
    expect(sourceNeedsFallback({ ...base, elapsedMs: SOURCE_STALL_GRACE_MS })).toBe(true)
    expect(sourceNeedsFallback({ ...base, currentTime: 3.2, elapsedMs: SOURCE_STALL_GRACE_MS })).toBe(false)
    expect(sourceNeedsFallback({ ...base, currentTime: 3.2, paused: true, elapsedMs: SOURCE_STALL_GRACE_MS })).toBe(true)
  })

  it('restarts a loop only while the document is active', () => {
    expect(shouldRestartSource(true, false)).toBe(true)
    expect(shouldRestartSource(true, true)).toBe(false)
    expect(shouldRestartSource(false, false)).toBe(false)
  })

  it('validates cross-tab playback signals before acting on them', () => {
    const signal = createPlaybackSignal('tab-a', '2026-07-18.5', 123)
    expect(isPlaybackSignal(signal)).toBe(true)
    expect(isPlaybackSignal({ ...signal, tabId: '' })).toBe(false)
    expect(isPlaybackSignal({ type: 'stop-everything', tabId: 'tab-b', build: signal.build, at: 123 })).toBe(false)
    expect(isPlaybackSignal('playback-start')).toBe(false)
  })
})
