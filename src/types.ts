export type TrackKind = 'original' | 'cover' | 'demo'
export type RecoveryStatus = 'source-missing' | 'original-module'

export interface LibraryTrack {
  id: string
  slug: string
  title: string
  shortTitle: string
  kind: TrackKind
  duration: number
  uploaded: string
  expansion: '2A03' | 'VRC6'
  description: string
  credit?: string
  sourceUrl: string
  audio: string
  poster: string
  recoveryStatus: RecoveryStatus
}

export type ChannelId =
  | 'pulse1'
  | 'pulse2'
  | 'triangle'
  | 'noise'
  | 'dpcm'
  | 'vrc6Pulse1'
  | 'vrc6Pulse2'
  | 'vrc6Saw'

export interface ChannelDefinition {
  id: ChannelId
  name: string
  short: string
  color: string
  oscillator: OscillatorType | 'noise' | 'sample' | 'sawtooth'
}

export interface TrackerCell {
  note: string | null
  instrument: number
  volume: number
  effect: string
}

export interface TrackerProject {
  version: 1
  sourceId: string
  title: string
  author: string
  tempo: number
  speed: number
  rows: number
  loop: boolean
  cells: Record<ChannelId, TrackerCell[]>
  updatedAt: string
  recoveryStatus: RecoveryStatus
}
