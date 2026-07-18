import { channels, library } from '../data/library'
import type { ChannelId, LibraryTrack, TrackerCell, TrackerProject } from '../types'

const channelIds = channels.map((channel) => channel.id)

export function emptyCell(): TrackerCell {
  return { note: null, instrument: 0, volume: 15, effect: '' }
}

export function createDraft(track: LibraryTrack, rows = 64): TrackerProject {
  const cells = Object.fromEntries(
    channelIds.map((id) => [id, Array.from({ length: rows }, emptyCell)]),
  ) as Record<ChannelId, TrackerCell[]>

  return {
    version: 1,
    sourceId: track.id,
    title: track.shortTitle,
    author: 'N9NES9',
    tempo: 150,
    speed: 6,
    rows,
    loop: true,
    cells,
    updatedAt: new Date().toISOString(),
    recoveryStatus: track.recoveryStatus,
  }
}

export function cloneProject(project: TrackerProject): TrackerProject {
  return structuredClone(project)
}

export function serializeProject(project: TrackerProject): string {
  return JSON.stringify({ ...project, updatedAt: new Date().toISOString() }, null, 2)
}

export function parseProject(input: string): TrackerProject {
  const parsed = JSON.parse(input) as Partial<TrackerProject>
  if (parsed.version !== 1 || typeof parsed.title !== 'string' || !parsed.cells || !Number.isInteger(parsed.rows)) {
    throw new Error('This is not a supported Chipvault project.')
  }
  for (const id of channelIds) {
    if (!Array.isArray(parsed.cells[id]) || parsed.cells[id].length !== parsed.rows) {
      throw new Error(`The ${id} channel is missing or has the wrong row count.`)
    }
  }
  return parsed as TrackerProject
}

function quote(value: string): string {
  return `"${value.replaceAll('"', "'")}"`
}

function famiNote(cell: TrackerCell, channelId: ChannelId): string {
  if (!cell.note) return '... .. . ...'
  const instrument = channelId.startsWith('vrc6') ? 1 : 0
  const effect = /^[0-9A-Z][0-9A-F]{2}$/.test(cell.effect.toUpperCase()) ? cell.effect.toUpperCase() : '...'
  return `${cell.note.padEnd(3, '.')} ${instrument.toString(16).padStart(2, '0').toUpperCase()} ${cell.volume.toString(16).toUpperCase()} ${effect}`
}

export function exportFamiTrackerText(project: TrackerProject): string {
  const expansion = channels.some((channel) => channel.id.startsWith('vrc6') && project.cells[channel.id].some((cell) => cell.note)) ? 1 : 0
  const activeChannels = expansion ? channelIds : channelIds.slice(0, 5)
  const lines = [
    '# FamiTracker text export 0.4.6',
    '',
    `TITLE ${quote(project.title)}`,
    `AUTHOR ${quote(project.author)}`,
    'COPYRIGHT ""',
    'COMMENT "Recovered in N9NES9 Chipvault; verify against the source recording."',
    '',
    'MACHINE 0',
    'FRAMERATE 0',
    `EXPANSION ${expansion}`,
    'VIBRATO 1',
    'SPLIT 32',
    'N163CHANNELS 0',
    '',
    'MACRO 0 0 -1 0 0 : 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1 0',
    'MACROVRC6 0 0 -1 0 0 : 15 14 13 12 11 10 9 8 7 6 5 4 3 2 1 0',
    '',
    'INST2A03 0 0 -1 -1 -1 -1 "2A03 Basic"',
    'INSTVRC6 1 0 -1 -1 -1 "VRC6 Basic"',
    '',
    `TRACK ${project.rows} ${project.speed} ${project.tempo} ${quote(project.title)}`,
    `COLUMNS : ${activeChannels.map(() => '1').join(' ')}`,
    '',
    `ORDER 00 : ${activeChannels.map(() => '00').join(' ')}`,
    '',
    'PATTERN 00',
  ]

  for (let row = 0; row < project.rows; row += 1) {
    const rowHex = row.toString(16).padStart(2, '0').toUpperCase()
    lines.push(`ROW ${rowHex} : ${activeChannels.map((id) => famiNote(project.cells[id][row], id)).join(' : ')}`)
  }
  return `${lines.join('\n')}\n`
}

export function importFamiTrackerText(input: string, sourceId = library[0].id): TrackerProject {
  if (!input.startsWith('# FamiTracker text export')) throw new Error('Not a FamiTracker text export.')
  const title = input.match(/^TITLE\s+"(.*)"/m)?.[1] ?? 'Imported module'
  const author = input.match(/^AUTHOR\s+"(.*)"/m)?.[1] ?? 'Unknown'
  const track = input.match(/^TRACK\s+(\d+)\s+(\d+)\s+(\d+)/m)
  const rows = Math.min(256, Math.max(1, Number(track?.[1] ?? 64)))
  const project = createDraft(library.find((item) => item.id === sourceId) ?? library[0], rows)
  project.title = title
  project.author = author
  project.speed = Number(track?.[2] ?? 6)
  project.tempo = Number(track?.[3] ?? 150)
  project.recoveryStatus = 'source-missing'
  const rowLines = input.match(/^ROW\s+[0-9A-F]{2}\s+:.*$/gim) ?? []
  rowLines.forEach((line, rowIndex) => {
    if (rowIndex >= rows) return
    const sections = line.split(':').slice(1).map((part) => part.trim())
    sections.slice(0, channelIds.length).forEach((section, channelIndex) => {
      const [note, instrument, volume, effect] = section.split(/\s+/)
      if (note && note !== '...') {
        project.cells[channelIds[channelIndex]][rowIndex] = {
          note,
          instrument: Number.parseInt(instrument ?? '0', 16) || 0,
          volume: Number.parseInt(volume ?? 'F', 16) || 15,
          effect: effect === '...' ? '' : (effect ?? ''),
        }
      }
    })
  })
  return project
}

export function downloadText(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function noteToMidi(note: string): number | null {
  const match = note.match(/^([A-G])([#-])(\d)$/)
  if (!match) return null
  const pitchClasses: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
  return (Number(match[3]) + 1) * 12 + pitchClasses[match[1]] + (match[2] === '#' ? 1 : 0)
}

export function midiToNote(midi: number): string {
  const names = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-']
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}
