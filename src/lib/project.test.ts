import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { library, tutorials } from '../data/library'
import { createDraft, exportFamiTrackerText, importFamiTrackerText, parseProject, serializeProject } from './project'

describe('Chipvault project interchange', () => {
  it('has a complete, unique 17-recording archive and documents both tutorials', () => {
    expect(library).toHaveLength(17)
    expect(tutorials).toHaveLength(2)
    expect(new Set(library.map((track) => track.id)).size).toBe(17)
    for (const track of library) {
      expect(existsSync(resolve('public', track.audio))).toBe(true)
      expect(existsSync(resolve('public', track.poster))).toBe(true)
    }
  })

  it('round-trips the native project without losing cells', () => {
    const project = createDraft(library[0])
    project.cells.pulse1[0].note = 'C-4'
    const restored = parseProject(serializeProject(project))
    expect(restored.cells.pulse1[0].note).toBe('C-4')
    expect(restored.sourceId).toBe(library[0].id)
  })

  it('exports the required FamiTracker 0.4.6 text sections', () => {
    const project = createDraft(library[0])
    project.cells.vrc6Saw[4].note = 'A-2'
    const output = exportFamiTrackerText(project)
    expect(output).toContain('# FamiTracker text export 0.4.6')
    expect(output).toContain('EXPANSION 1')
    expect(output).toContain('TRACK 64 6 150')
    expect(output).toContain('ROW 04')
    expect(output).toContain('A-2 01 F')
  })

  it('re-imports the module text it exports', () => {
    const project = createDraft(library[1])
    project.cells.pulse2[12].note = 'F#5'
    const restored = importFamiTrackerText(exportFamiTrackerText(project), project.sourceId)
    expect(restored.cells.pulse2[12].note).toBe('F#5')
    expect(restored.title).toBe(project.title)
  })
})
