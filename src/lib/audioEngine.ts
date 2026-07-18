import type { ChannelDefinition, TrackerCell } from '../types'
import { noteToMidi } from './project'

export class ChipAudioEngine {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private active = new Set<AudioScheduledSourceNode>()

  private ensureContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext()
      this.master = this.context.createGain()
      this.master.gain.value = 0.22
      this.master.connect(this.context.destination)
    }
    return this.context
  }

  async unlock(): Promise<boolean> {
    try {
      const context = this.ensureContext()
      if (context.state === 'suspended') await context.resume()
      return context.state === 'running'
    } catch {
      return false
    }
  }

  play(cell: TrackerCell, channel: ChannelDefinition, duration: number): boolean {
    if (!cell.note || channel.oscillator === 'sample') return false
    try {
      const context = this.ensureContext()
      if (context.state === 'suspended') void context.resume()
      const gain = context.createGain()
      const now = context.currentTime
      const volume = Math.max(0.015, (cell.volume ?? 15) / 15)
      gain.gain.setValueAtTime(volume, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + Math.max(0.03, duration * 0.92))
      gain.connect(this.master!)

      if (channel.oscillator === 'noise') {
        const length = Math.ceil(context.sampleRate * Math.min(duration, 0.12))
        const buffer = context.createBuffer(1, length, context.sampleRate)
        const data = buffer.getChannelData(0)
        for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(gain)
        this.track(source)
        source.start(now)
        source.stop(now + Math.min(duration, 0.12))
        return true
      }

      const midi = noteToMidi(cell.note)
      if (midi === null) return false
      const oscillator = context.createOscillator()
      oscillator.type = channel.oscillator
      oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12)
      oscillator.connect(gain)
      this.track(oscillator)
      oscillator.start(now)
      oscillator.stop(now + duration)
      return true
    } catch {
      return false
    }
  }

  stop(): void {
    this.active.forEach((source) => {
      try { source.stop() } catch { /* already stopped */ }
    })
    this.active.clear()
  }

  private track(source: AudioScheduledSourceNode): void {
    this.active.add(source)
    source.addEventListener('ended', () => this.active.delete(source), { once: true })
  }
}
