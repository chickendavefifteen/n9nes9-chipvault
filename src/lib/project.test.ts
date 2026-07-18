import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { library, tutorials } from '../data/library'
import { recoveredProjectForTrack } from '../data/recovered'
import { createDraft, exportFamiTrackerText, importFamiTrackerText, parseProject, serializeProject } from './project'
import { buildUpdateAction, BUILD_ID, isNewerBuild, shouldReloadBuild } from './versioning'

describe('Chipvault project interchange', () => {
  it('has a complete, unique 17-recording archive, external bonus, and both tutorials', () => {
    expect(library).toHaveLength(18)
    expect(tutorials).toHaveLength(2)
    expect(new Set(library.map((track) => track.id)).size).toBe(18)
    expect(library.filter((track) => track.audio)).toHaveLength(17)
    for (const track of library) {
      if (track.audio) expect(existsSync(resolve('public', track.audio))).toBe(true)
      expect(existsSync(resolve('public', track.poster))).toBe(true)
    }
    const bonus = library.find((track) => track.kind === 'bonus')
    expect(bonus?.externalVideoId).toBe('ez8m4PXksQs')
    expect(bonus?.externalEnd).toBe(600)
    expect(bonus?.audio).toBeUndefined()
  })

  it('round-trips the native project without losing cells', () => {
    const project = createDraft(library[0])
    project.cells.pulse1[0].note = 'C-4'
    project.cells.pulse1[0].edited = true
    const restored = parseProject(serializeProject(project))
    expect(restored.cells.pulse1[0].note).toBe('C-4')
    expect(restored.cells.pulse1[0].edited).toBe(true)
    expect(restored.sourceId).toBe(library[0].id)
    expect(exportFamiTrackerText(restored)).not.toContain('EDIT')
  })

  it('reloads only when the no-cache manifest is newer', () => {
    expect(BUILD_ID).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
    expect(shouldReloadBuild(BUILD_ID)).toBe(false)
    expect(shouldReloadBuild('2026-07-18.4')).toBe(false)
    expect(shouldReloadBuild('2026-07-18.6')).toBe(true)
    expect(shouldReloadBuild('broken')).toBe(false)
    expect(isNewerBuild('2026-07-18.5', '2026-07-18.4')).toBe(true)
    expect(buildUpdateAction('2026-07-18.6', { playbackActive: false, editing: false, storageHealthy: true })).toBe('reload')
    expect(buildUpdateAction('2026-07-18.6', { playbackActive: true, editing: false, storageHealthy: true })).toBe('notify')
    expect(buildUpdateAction('2026-07-18.6', { playbackActive: false, editing: true, storageHealthy: true })).toBe('notify')
    expect(buildUpdateAction('2026-07-18.6', { playbackActive: false, editing: false, storageHealthy: false })).toBe('notify')
  })

  it('exports the required FamiTracker 0.4.6 text sections', () => {
    const project = createDraft(library[0])
    project.cells.vrc6Saw[4].note = 'A-2'
    const output = exportFamiTrackerText(project)
    expect(output).toContain('# FamiTracker text export 0.4.6')
    expect(output).toContain('EXPANSION 1')
    expect(output).toContain('TRACK 64 6 150')
    expect(output).toContain('ROW 04')
    expect(output).toContain('A-2 01 .')
  })

  it('re-imports the module text it exports', () => {
    const project = createDraft(library[1])
    project.cells.pulse2[12].note = 'F#5'
    const restored = importFamiTrackerText(exportFamiTrackerText(project), project.sourceId)
    expect(restored.cells.pulse2[12].note).toBe('F#5')
    expect(restored.title).toBe(project.title)
  })

  it('round-trips recovered multi-pattern data and effect-only rows', () => {
    const recovered = recoveredProjectForTrack(library.find((track) => track.id === 'TejsLqPt0-k')!)!
    expect(recovered.rows).toBe(128)
    expect(recovered.patternLength).toBe(64)
    expect(recovered.cells.vrc6Pulse1.filter((cell) => cell.note).length).toBeGreaterThan(20)
    const exported = exportFamiTrackerText(recovered)
    expect(exported).toContain('ORDER 01')
    expect(exported).toContain('PATTERN 01')
    expect(exported).toContain('INST2A03 3')
    expect(exported).toContain('INSTVRC6 0')
    const restored = importFamiTrackerText(exported, recovered.sourceId)
    expect(restored.rows).toBe(128)
    expect(restored.cells.vrc6Pulse1[64].note).toBe(recovered.cells.vrc6Pulse1[64].note)
    const effectRow = recovered.cells.vrc6Pulse1.findIndex((cell) => !cell.note && cell.effect)
    if (effectRow >= 0) expect(restored.cells.vrc6Pulse1[effectRow].effect).toBe(recovered.cells.vrc6Pulse1[effectRow].effect)
  })
})
