import { afterEach, describe, expect, it } from 'vitest'
import { channelMixLevel, ChipAudioEngine } from './audioEngine'
import type { ChannelDefinition, TrackerCell } from '../types'

const originalAudioContext = globalThis.AudioContext

afterEach(() => {
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: originalAudioContext })
})

describe('chip audio fallback', () => {
  it('keeps dense reconstructed channels below the lead and rhythm out of the foreground', () => {
    expect(channelMixLevel('vrc6Pulse1')).toBeGreaterThan(channelMixLevel('vrc6Pulse2'))
    expect(channelMixLevel('vrc6Pulse1')).toBeGreaterThan(channelMixLevel('vrc6Saw'))
    expect(channelMixLevel('noise')).toBeLessThan(channelMixLevel('vrc6Pulse2'))
    expect(channelMixLevel('dpcm')).toBe(0)
  })

  it('unlocks the audio context during a user-started transport action', async () => {
    class FakeAudioContext {
      state: AudioContextState = 'suspended'
      destination = {}
      createGain() { return { gain: { value: 0 }, connect: () => undefined } }
      async resume() { this.state = 'running' }
    }
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext })
    await expect(new ChipAudioEngine().unlock()).resolves.toBe(true)
  })

  it('contains unavailable Web Audio without crashing the transport', async () => {
    class MissingAudioContext {
      constructor() { throw new Error('AudioContext unavailable') }
    }
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: MissingAudioContext })
    const engine = new ChipAudioEngine()
    const cell: TrackerCell = { note: 'C-4', instrument: 0, volume: 15, effect: '' }
    const channel: ChannelDefinition = { id: 'pulse1', name: 'Pulse 1', short: 'P1', color: '#fff', oscillator: 'square' }
    await expect(engine.unlock()).resolves.toBe(false)
    expect(engine.play(cell, channel, 0.1)).toBe(false)
  })
})
