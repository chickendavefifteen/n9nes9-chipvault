import type { ChannelId, LibraryTrack, TrackerCell, TrackerProject } from '../types'
import { createDraft } from '../lib/project'

const blank = (): TrackerCell => ({ note: null, instrument: null, volume: null, effect: '' })

function put(project: TrackerProject, channel: ChannelId, row: number, note: string | null, instrument: number | null = null, volume: number | null = null, effect = '') {
  project.cells[channel][row] = { note, instrument, volume, effect }
}

function populateRhythm(project: TrackerProject, offset: number) {
  const pulse1 = ['G-3', 'B-3', 'G-4', 'B-4', 'G-4', 'B-3', 'G-3', 'B-3']
  const pulse2 = ['G-3', 'E-3', 'G-4', 'E-4', 'G-4', 'E-3', 'G-3', 'E-3']
  const noise = [
    '0-#','E-#','E-#','E-#','6-#','E-#','E-#','E-#','0-#','E-#','E-#','E-#','6-#','E-#','E-#','E-#',
    'E-#','E-#','0-#','E-#','6-#','E-#','E-#','E-#','0-#','E-#','0-#','E-#','6-#','E-#','E-#','E-#',
    '0-#','E-#','E-#','E-#','6-#','E-#','E-#','E-#','0-#','E-#','0-#','E-#','6-#','E-#','0-#','E-#',
    'E-#','E-#','0-#','E-#','6-#','E-#','E-#','E-#','0-#','E-#','0-#','E-#','6-#','E-#','E-#','E-#',
  ]
  for (let row = 0; row < 64; row += 1) {
    put(project, 'pulse1', offset + row, pulse1[row % pulse1.length], 3, row === 0 ? 9 : null)
    if (row > 0) put(project, 'pulse2', offset + row, pulse2[(row - 1) % pulse2.length], 3, row === 1 ? 5 : null)
    put(project, 'noise', offset + row, noise[row], 3, noise[row] === 'E-#' ? 9 : 12)
  }
  const saw: Array<[number, string]> = [
    [0,'G-0'],[2,'G-1'],[4,'G-0'],[6,'A#0'],[10,'A#1'],[12,'A#0'],[14,'C-1'],[18,'C-2'],[20,'G-1'],[22,'F-0'],
    [26,'F-1'],[28,'F#0'],[30,'F#1'],[32,'G-0'],[34,'G-1'],[36,'G-0'],[38,'A#0'],[42,'A#1'],[44,'A#0'],[46,'C-1'],
    [50,'C-2'],[52,'C-1'],[54,'F-0'],[58,'F-1'],[60,'F#0'],[62,'F#1'],
  ]
  saw.forEach(([row, note]) => put(project, 'vrc6Saw', offset + row, note, 0))
}

function populateOrderZero(project: TrackerProject) {
  const v1: Array<[number, string | null, number | null, string?]> = [
    [0,'C-4',10,'V06'],[4,'B-3',null],[8,'G-3',null],[10,'F-3',null],[14,'G-3',null],[18,'B-3',null],
    [20,'C-4',null],[22,'D-4',null,'306'],[24,null,null,'300'],[26,'C-4',null],[28,'B-3',null],[30,'G-3',null],
    [32,'B-3',null],[34,'G-3',null],[36,'F-3',null],[38,'G-3',null],[40,null,null,'463'],[48,null,null,'400'],
    [50,'B-3',null],[52,'C-4',null],[54,'D-4',null],
  ]
  const v2: Array<[number, string | null, number | null, string?]> = [
    [3,'C-4',6,'V06'],[7,'B-3',null],[11,'G-3',null],[13,'F-3',null],[17,'G-3',null],[21,'B-3',null],
    [23,'C-4',null],[25,'D-4',null,'306'],[27,null,null,'300'],[29,'C-4',null],[31,'B-3',null],[33,'G-3',null],
    [35,'B-3',null],[37,'G-3',null],[39,'F-3',null],[41,'G-3',null],[43,null,null,'463'],[51,null,null,'400'],
    [53,'B-3',null],[55,'C-4',null],[57,'D-4',null],
  ]
  v1.forEach(([row, note, volume, effect]) => put(project, 'vrc6Pulse1', row, note, note ? 0 : null, volume, effect))
  v2.forEach(([row, note, volume, effect]) => put(project, 'vrc6Pulse2', row, note, note ? 0 : null, volume, effect))
}

function populateOrderOne(project: TrackerProject) {
  const offset = 64
  const v1: Array<[number, string | null, number | null, string?]> = [
    [0,'G-4',10],[4,'F-4',null],[8,'D-4',null],[10,'C-4',null],[14,'D-4',null,'306'],[16,null,null,'300'],
    [18,'C-4',null],[20,'B-3',null],[22,'G-3',null],[24,'C-4',null],[26,'B-3',null],[28,'F-3',null],
    [30,'G-3',null],[32,null,null,'463'],[44,null,null,'400'],[46,'G-4',null],[48,null,null,'463'],[60,null,null,'400'],
  ]
  const v2: Array<[number, string | null, number | null, string?]> = [
    [3,'G-4',6],[7,'F-4',null],[11,'D-4',null],[13,'C-4',null],[17,'D-4',null,'306'],[19,null,null,'300'],
    [21,'C-4',null],[23,'B-3',null],[25,'G-3',null],[27,'C-4',null],[29,'B-3',null],[31,'F-3',null],
    [35,null,null,'463'],[47,null,null,'400'],[49,'G-4',null],[51,null,null,'463'],[63,null,null,'400'],
  ]
  v1.forEach(([row, note, volume, effect]) => put(project, 'vrc6Pulse1', offset + row, note, note ? 0 : null, volume, effect))
  v2.forEach(([row, note, volume, effect]) => put(project, 'vrc6Pulse2', offset + row, note, note ? 0 : null, volume, effect))
}

function gameCompleteLoop(track: LibraryTrack): TrackerProject {
  const project = createDraft(track, 128)
  project.cells = Object.fromEntries(Object.keys(project.cells).map((id) => [id, Array.from({ length: 128 }, blank)])) as TrackerProject['cells']
  project.patternLength = 64
  project.recoveryStatus = 'pattern-recovered'
  project.contentRevision = 1
  project.sourceSync = {
    audioOffset: 1.839,
    secondsPerRow: 0.1,
    loopRows: 128,
    confidence: 0.92,
    evidence: ['YouTube video frames at 1s, 7s, 8s, and 12s', 'FFmpeg silence boundary at 1.839s', 'Two visible 64-row FamiTracker orders'],
  }
  populateRhythm(project, 0)
  populateRhythm(project, 64)
  populateOrderZero(project)
  populateOrderOne(project)
  return project
}

export function recoveredProjectForTrack(track: LibraryTrack): TrackerProject | null {
  return track.id === 'TejsLqPt0-k' ? gameCompleteLoop(track) : null
}
