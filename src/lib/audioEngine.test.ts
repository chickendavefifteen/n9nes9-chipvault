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
    expect(channelMixLevel('dpcm')).toBeGreaterThan(channelMixLevel('noise'))
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

  it('synthesizes an audible percussion burst for DPCM cells', () => {
    let oscillatorStarts = 0
    class FakeAudioContext {
      state: AudioContextState = 'running'
      currentTime = 0
      destination = {}
      createGain() {
        return {
          gain: { value: 0, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
          connect: () => undefined,
        }
      }
      createOscillator() {
        return {
          type: 'triangle',
          frequency: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined },
          connect: () => undefined,
          start: () => { oscillatorStarts += 1 },
          stop: () => undefined,
          addEventListener: () => undefined,
        }
      }
    }
    Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: FakeAudioContext })
    const cell: TrackerCell = { note: 'C-4', instrument: 0, volume: 15, effect: '', edited: true }
    const channel: ChannelDefinition = { id: 'dpcm', name: 'DPCM', short: 'DMC', color: '#fff', oscillator: 'sample' }
    expect(new ChipAudioEngine().play(cell, channel, 0.1)).toBe(true)
    expect(oscillatorStarts).toBe(1)
  })
})
