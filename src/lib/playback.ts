import type { SourceSync } from '../types'

export const SOURCE_STALL_GRACE_MS = 1_600
export const PLAYBACK_SIGNAL_KEY = 'n9nes9-chipvault:playback-signal'

export interface SourceHealth {
  elapsedMs: number
  initialTime: number
  currentTime: number
  paused: boolean
  readyState: number
}

export interface PlaybackSignal {
  type: 'playback-start'
  tabId: string
  build: string
  at: number
}

export function sourceRowPosition(
  currentTime: number,
  sync: SourceSync | undefined,
  tempo: number,
  rows: number,
): number {
  const secondsPerRow = sync?.secondsPerRow ?? 60 / Math.max(1, tempo) / 4
  const audioOffset = sync?.audioOffset ?? 0
  const loopRows = Math.max(1, sync?.loopRows ?? rows)
  const elapsed = Math.max(0, currentTime - audioOffset)
  return (elapsed / secondsPerRow) % loopRows
}

export function sourceTimeForRow(
  row: number,
  sync: SourceSync | undefined,
  tempo: number,
  rows: number,
): number {
  const secondsPerRow = sync?.secondsPerRow ?? 60 / Math.max(1, tempo) / 4
  const audioOffset = sync?.audioOffset ?? 0
  const loopRows = Math.max(1, sync?.loopRows ?? rows)
  const normalizedRow = ((Math.floor(row) % loopRows) + loopRows) % loopRows
  return audioOffset + normalizedRow * secondsPerRow
}

export function sourcePlaybackRate(sync: SourceSync | undefined, tempo: number): number {
  const sourceSecondsPerRow = sync?.secondsPerRow ?? 60 / Math.max(1, tempo) / 4
  const editedSecondsPerRow = 60 / Math.max(1, tempo) / 4
  return Math.min(4, Math.max(0.25, sourceSecondsPerRow / editedSecondsPerRow))
}

export function sourceNeedsFallback(health: SourceHealth): boolean {
  if (health.elapsedMs < SOURCE_STALL_GRACE_MS) return false
  const advanced = health.currentTime - health.initialTime > 0.025
  return health.paused || health.readyState < 2 || !advanced
}

export function shouldRestartSource(loop: boolean, documentHidden: boolean): boolean {
  return loop && !documentHidden
}

export function sourceLoopStart(sync: SourceSync | undefined): number {
  return sync?.audioOffset ?? 0
}

export function createPlaybackSignal(tabId: string, build: string, at = Date.now()): PlaybackSignal {
  return { type: 'playback-start', tabId, build, at }
}

export function isPlaybackSignal(value: unknown): value is PlaybackSignal {
  if (!value || typeof value !== 'object') return false
  const signal = value as Partial<PlaybackSignal>
  return signal.type === 'playback-start'
    && typeof signal.tabId === 'string'
    && signal.tabId.length > 0
    && typeof signal.build === 'string'
    && typeof signal.at === 'number'
    && Number.isFinite(signal.at)
}
