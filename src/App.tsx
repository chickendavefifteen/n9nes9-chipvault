import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { channels, library } from './data/library'
import { recoveredProjectForTrack } from './data/recovered'
import { ChipAudioEngine } from './lib/audioEngine'
import {
  cloneProject,
  createDraft,
  downloadText,
  exportFamiTrackerText,
  importFamiTrackerText,
  midiToNote,
  parseProject,
  serializeProject,
} from './lib/project'
import { buildUpdateAction, BUILD_ID, fetchBuildManifest } from './lib/versioning'
import { browserStorage, clearStorageKeys, safeStorageSet } from './lib/reliability'
import { cellKey, rectangularSelection, selectionBounds, type GridPoint, type GridSelection } from './lib/selection'
import {
  createPlaybackSignal,
  isPlaybackSignal,
  PLAYBACK_SIGNAL_KEY,
  shouldRestartSource,
  SOURCE_STALL_GRACE_MS,
  sourceLoopStart,
  sourceNeedsFallback,
  sourcePlaybackRate,
  sourceRowPosition,
  sourceTimeForRow,
} from './lib/playback'
import type { ChannelId, LibraryTrack, TrackerProject } from './types'

type ViewMode = 'tracker' | 'piano'
type Filter = 'all' | 'original' | 'cover' | 'demo' | 'bonus'
type PreviewMode = 'source' | 'chip'
type ChipPurpose = 'preview' | 'fallback' | 'layered'
type SaveStatus = 'dirty' | 'saved' | 'temporary'

const engine = new ChipAudioEngine()
const EDITING_ENABLED = false
const LAYERED_BACKING_VOLUME = 0.88
const LAYERED_EDIT_DUCK_VOLUME = 0.46
const trackerChannelIds = channels.map((channel) => channel.id)
const storageKey = (id: string) => `n9nes9-chipvault:${id}`
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`

function configureReferenceAudio(audio: HTMLAudioElement, volume = 1, playbackRate = 1) {
  audio.volume = volume
  audio.playbackRate = playbackRate
  const pitchSafeAudio = audio as HTMLAudioElement & {
    preservesPitch?: boolean
    mozPreservesPitch?: boolean
    webkitPreservesPitch?: boolean
  }
  if ('preservesPitch' in pitchSafeAudio) pitchSafeAudio.preservesPitch = true
  if ('mozPreservesPitch' in pitchSafeAudio) pitchSafeAudio.mozPreservesPitch = true
  if ('webkitPreservesPitch' in pitchSafeAudio) pitchSafeAudio.webkitPreservesPitch = true
}

function loadProject(track: LibraryTrack): TrackerProject {
  const recovered = recoveredProjectForTrack(track)
  return recovered ?? createDraft(track)
}

function filename(title: string, extension: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.${extension}`
}

function projectPreviewRow(project: TrackerProject): number | null {
  const storedRow = project.previewStartRow
  if (typeof storedRow === 'number' && Number.isInteger(storedRow) && storedRow >= 0 && storedRow < project.rows) {
    return storedRow
  }
  let editedRow: number | null = null
  for (let row = 0; row < project.rows; row += 1) {
    if (channels.some((channel) => project.cells[channel.id][row].edited)) editedRow = row
  }
  return editedRow
}

function App() {
  const defaultTrack = library.find((track) => track.recoveryStatus === 'pattern-recovered') ?? library[0]
  const initialTrack = library.find((track) => `#${track.slug}` === window.location.hash) ?? defaultTrack
  const [selectedId, setSelectedId] = useState(initialTrack.id)
  const selectedTrack = library.find((track) => track.id === selectedId) ?? library[0]
  const [project, setProject] = useState(() => {
    clearStorageKeys(browserStorage(), library.map((track) => storageKey(track.id)))
    return loadProject(initialTrack)
  })
  const [undoStack, setUndoStack] = useState<TrackerProject[]>([])
  const [redoStack, setRedoStack] = useState<TrackerProject[]>([])
  const [view, setView] = useState<ViewMode>('tracker')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<ChannelId>('pulse1')
  const [selectedRow, setSelectedRow] = useState(0)
  const [cellSelection, setCellSelection] = useState<GridSelection>(() => ({
    anchor: { channelId: 'pulse1', row: 0 },
    focus: { channelId: 'pulse1', row: 0 },
  }))
  const [octave, setOctave] = useState(4)
  const [playing, setPlaying] = useState(false)
  const [referenceStarting, setReferenceStarting] = useState(false)
  const [referencePlaying, setReferencePlaying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [previewMode, setPreviewMode] = useState<PreviewMode>(() => (
    projectPreviewRow(project) !== null ? 'chip' : initialTrack.audio ? 'source' : 'chip'
  ))
  const [chipPurpose, setChipPurpose] = useState<ChipPurpose | null>(null)
  const [lastEditedRow, setLastEditedRow] = useState<number | null>(() => projectPreviewRow(project))
  const [playhead, setPlayhead] = useState(() => projectPreviewRow(project) ?? 0)
  const [muted, setMuted] = useState<Set<ChannelId>>(new Set())
  const [message, setMessage] = useState('Ready')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const [storageHealthy, setStorageHealthy] = useState(() => browserStorage() !== null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>(() => browserStorage() ? 'saved' : 'temporary')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const timerRef = useRef<number | null>(null)
  const sourceAttemptRef = useRef(0)
  const internalPauseRef = useRef(false)
  const sourceWatchdogRef = useRef<number | null>(null)
  const playbackChannelRef = useRef<BroadcastChannel | null>(null)
  const tabIdRef = useRef(`tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  const playbackActiveRef = useRef(false)
  const editingRef = useRef(editing)
  const previewModeRef = useRef<PreviewMode>(previewMode)
  const chipPurposeRef = useRef<ChipPurpose | null>(null)
  const chipStartRowRef = useRef(playhead)
  const layeredResumeTimeRef = useRef<number | null>(null)
  const storageHealthyRef = useRef(storageHealthy)
  const selectionDraggingRef = useRef(false)

  const filtered = useMemo(() => library.filter((track) => {
    const matchesFilter = filter === 'all' || track.kind === filter
    const haystack = `${track.shortTitle} ${track.description} ${track.credit ?? ''}`.toLowerCase()
    return matchesFilter && haystack.includes(query.trim().toLowerCase())
  }), [filter, query])
  const selectedTargets = useMemo(() => rectangularSelection(cellSelection, trackerChannelIds, project.rows), [cellSelection, project.rows])
  const selectedCellKeys = useMemo(() => new Set(selectedTargets.map((point) => cellKey(point.channelId, point.row))), [selectedTargets])
  const selectedBounds = useMemo(() => selectionBounds(selectedTargets), [selectedTargets])
  const selectionSummary = selectedBounds
    ? `${selectedTargets.length} cell${selectedTargets.length === 1 ? '' : 's'} selected · rows ${selectedBounds.firstRow.toString(16).padStart(2, '0').toUpperCase()}–${selectedBounds.lastRow.toString(16).padStart(2, '0').toUpperCase()}`
    : 'No cells selected'
  const selectedCell = project.cells[selectedChannel][selectedRow]
  const editedCount = useMemo(() => channels.reduce((total, channel) => (
    total + project.cells[channel.id].filter((cell) => cell.edited).length
  ), 0), [project])
  const hasEditedPreview = projectPreviewRow(project) !== null
  const hasLayeredPreview = Boolean(selectedTrack.audio && hasEditedPreview)
  const referenceActive = referenceStarting || referencePlaying
  const playbackActive = playing || referenceActive
  const transportMode = playing
    ? chipPurpose === 'layered' ? 'layered-preview' : chipPurpose === 'fallback' ? 'chip-fallback' : 'chip-preview'
    : referencePlaying ? 'source-playing' : referenceStarting ? 'source-starting' : 'idle'
  const playbackName = chipPurpose === 'layered'
    ? 'layered edit mix'
    : referenceActive
      ? 'original recording'
      : playing
        ? 'browser pattern playback'
        : previewMode === 'chip'
          ? hasLayeredPreview ? 'layered edit mix' : 'browser pattern playback'
          : selectedTrack.audio ? 'original recording' : 'browser pattern playback'
  const editedStartLabel = lastEditedRow === null ? null : `${Math.floor(lastEditedRow / project.patternLength).toString(16).padStart(2, '0').toUpperCase()}:${(lastEditedRow % project.patternLength).toString(16).padStart(2, '0').toUpperCase()}`
  const savedTime = lastSavedAt === null ? null : new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const saveText = saveStatus === 'temporary'
    ? 'Not saved · export to keep'
    : saveStatus === 'dirty'
      ? `Unsaved changes · ${editedCount} edit${editedCount === 1 ? '' : 's'}`
      : `Saved in this browser${savedTime ? ` · ${savedTime}` : ''} · ${editedCount} edit${editedCount === 1 ? '' : 's'}`

  useEffect(() => {
    playbackActiveRef.current = playbackActive
    editingRef.current = editing
    previewModeRef.current = previewMode
    storageHealthyRef.current = storageHealthy
  }, [editing, playbackActive, previewMode, storageHealthy])

  const commit = useCallback((mutate: (draft: TrackerProject) => void) => {
    setSaveStatus('dirty')
    setProject((current) => {
      setUndoStack((stack) => [...stack.slice(-49), cloneProject(current)])
      setRedoStack([])
      const next = cloneProject(current)
      mutate(next)
      next.updatedAt = new Date().toISOString()
      return next
    })
  }, [])

  const stopChip = useCallback((nextMessage?: string) => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
    engine.stop()
    chipPurposeRef.current = null
    setPlaying(false)
    setChipPurpose(null)
    if (nextMessage) setMessage(nextMessage)
  }, [])

  const clearSourceWatchdog = useCallback(() => {
    if (sourceWatchdogRef.current !== null) window.clearTimeout(sourceWatchdogRef.current)
    sourceWatchdogRef.current = null
  }, [])

  const pauseReference = useCallback(() => {
    sourceAttemptRef.current += 1
    clearSourceWatchdog()
    const audio = audioRef.current
    if (audio && !audio.paused) internalPauseRef.current = true
    audio?.pause()
    if (audio) configureReferenceAudio(audio)
    setReferenceStarting(false)
    setReferencePlaying(false)
  }, [clearSourceWatchdog])

  const stopEverything = useCallback((nextMessage?: string) => {
    stopChip()
    pauseReference()
    playbackActiveRef.current = false
    if (nextMessage) setMessage(nextMessage)
  }, [pauseReference, stopChip])

  const beginCellSelection = useCallback((channelId: ChannelId, row: number, extend: boolean) => {
    selectionDraggingRef.current = editingRef.current
    setSelectedChannel(channelId)
    setSelectedRow(row)
    setCellSelection((current) => extend
      ? { anchor: current.anchor, focus: { channelId, row } }
      : { anchor: { channelId, row }, focus: { channelId, row } })
  }, [])

  const selectSingleCell = useCallback((channelId: ChannelId, row: number) => {
    setSelectedChannel(channelId)
    setSelectedRow(row)
    setCellSelection({ anchor: { channelId, row }, focus: { channelId, row } })
  }, [])

  const extendCellSelection = useCallback((channelId: ChannelId, row: number) => {
    if (!selectionDraggingRef.current || !editingRef.current) return
    setSelectedChannel(channelId)
    setSelectedRow(row)
    setCellSelection((current) => ({ ...current, focus: { channelId, row } }))
  }, [])

  const endCellSelection = useCallback(() => {
    selectionDraggingRef.current = false
  }, [])

  useEffect(() => {
    const followPointer = (event: PointerEvent | MouseEvent) => {
      if (!selectionDraggingRef.current || !editingRef.current) return
      const element = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLButtonElement>('button[data-grid-channel][data-grid-row]')
      const channelId = element?.dataset.gridChannel as ChannelId | undefined
      const row = Number(element?.dataset.gridRow)
      if (!channelId || !trackerChannelIds.includes(channelId) || !Number.isInteger(row)) return
      extendCellSelection(channelId, row)
    }
    window.addEventListener('pointermove', followPointer)
    window.addEventListener('mousemove', followPointer)
    window.addEventListener('pointerup', endCellSelection)
    window.addEventListener('mouseup', endCellSelection)
    window.addEventListener('pointercancel', endCellSelection)
    return () => {
      window.removeEventListener('pointermove', followPointer)
      window.removeEventListener('mousemove', followPointer)
      window.removeEventListener('pointerup', endCellSelection)
      window.removeEventListener('mouseup', endCellSelection)
      window.removeEventListener('pointercancel', endCellSelection)
    }
  }, [endCellSelection, extendCellSelection])

  useEffect(() => {
    if (saveStatus !== 'dirty') return
    const warnOnClose = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnOnClose)
    return () => window.removeEventListener('beforeunload', warnOnClose)
  }, [saveStatus])

  const saveWorkspace = () => {
    const saved = safeStorageSet(browserStorage(), storageKey(selectedId), serializeProject(project))
    setStorageHealthy(saved)
    storageHealthyRef.current = saved
    if (!saved) {
      setSaveStatus('temporary')
      setMessage('This browser blocked local save · export JSON to keep these changes')
      return
    }

    const savedEditRow = projectPreviewRow(project)
    const mode: PreviewMode = savedEditRow !== null ? 'chip' : selectedTrack.audio ? 'source' : 'chip'
    stopEverything()
    editingRef.current = false
    previewModeRef.current = mode
    setEditing(false)
    setPreviewMode(mode)
    setSaveStatus('saved')
    setLastSavedAt(Date.now())
    if (savedEditRow !== null) {
      layeredResumeTimeRef.current = null
      chipStartRowRef.current = savedEditRow
      setLastEditedRow(savedEditRow)
      setPlayhead(savedEditRow)
    }
    setMessage(mode === 'chip'
      ? selectedTrack.audio ? 'Saved locally · Play now uses the layered edit mix' : 'Saved locally · Play now uses your edited pattern'
      : 'Saved locally · Play mode ready')
  }

  const armEditedPreview = useCallback((row: number, detail: string) => {
    previewModeRef.current = 'chip'
    layeredResumeTimeRef.current = null
    chipStartRowRef.current = row
    if (playbackActiveRef.current) stopEverything()
    const order = Math.floor(row / project.patternLength).toString(16).padStart(2, '0').toUpperCase()
    const patternRow = (row % project.patternLength).toString(16).padStart(2, '0').toUpperCase()
    setPreviewMode('chip')
    setPlayhead(row)
    setLastEditedRow(row)
    setMessage(`${detail} · unsaved · Layered edit mix armed at ${order}:${patternRow}`)
  }, [project.patternLength, stopEverything])

  const commitPreviewEdit = useCallback((mutate: (draft: TrackerProject) => void, row: number, detail: string) => {
    commit((draft) => {
      mutate(draft)
      draft.previewStartRow = row
    })
    armEditedPreview(row, detail)
  }, [armEditedPreview, commit])

  const broadcastPlayback = useCallback(() => {
    const signal = createPlaybackSignal(tabIdRef.current, BUILD_ID)
    playbackChannelRef.current?.postMessage(signal)
    safeStorageSet(browserStorage(), PLAYBACK_SIGNAL_KEY, JSON.stringify(signal))
  }, [])

  const syncReference = useCallback(() => {
    const audio = audioRef.current
    if (!audio || (previewModeRef.current === 'chip' && chipPurposeRef.current !== 'layered')) return
    setPlayhead(Math.floor(sourceRowPosition(audio.currentTime, project.sourceSync, project.tempo, project.rows)))
  }, [project.rows, project.sourceSync, project.tempo])

  const startChip = useCallback((nextMessage = 'Playing browser pattern', purpose: ChipPurpose = 'preview') => {
    stopChip()
    pauseReference()
    broadcastPlayback()
    void engine.unlock()
    chipPurposeRef.current = purpose
    setChipPurpose(purpose)
    if (purpose === 'fallback') {
      previewModeRef.current = 'chip'
      setPreviewMode('chip')
    }
    const rowDuration = 60 / project.tempo / 4
    const sessionTicks = selectedTrack.kind === 'bonus' ? Math.ceil(selectedTrack.duration / rowDuration) : Number.POSITIVE_INFINITY
    let elapsedTicks = 0
    let row = purpose === 'preview' ? chipStartRowRef.current : playhead
    const tick = () => {
      if (elapsedTicks >= sessionTicks) {
        stopChip('Ten-minute bonus session finished')
        return
      }
      setPlayhead(row)
      chipStartRowRef.current = row
      channels.forEach((channel) => {
        if (!muted.has(channel.id)) engine.play(project.cells[channel.id][row], channel, rowDuration * 0.9)
      })
      row += 1
      elapsedTicks += 1
      if (row >= project.rows) {
        if (project.loop) row = 0
        else {
          chipStartRowRef.current = Math.max(0, project.rows - 1)
          stopChip('Finished')
          return
        }
      }
      chipStartRowRef.current = row
    }
    tick()
    timerRef.current = window.setInterval(tick, rowDuration * 1000)
    setPlaying(true)
    setMessage(nextMessage)
  }, [broadcastPlayback, muted, pauseReference, playhead, project, selectedTrack.duration, selectedTrack.kind, stopChip])

  const armSourceWatchdog = useCallback((attempt: number, initialTime: number) => {
    clearSourceWatchdog()
    const startedAt = Date.now()
    sourceWatchdogRef.current = window.setTimeout(() => {
      if (sourceAttemptRef.current !== attempt) return
      const audio = audioRef.current
      if (!audio || sourceNeedsFallback({
        elapsedMs: Date.now() - startedAt,
        initialTime,
        currentTime: audio.currentTime,
        paused: audio.paused,
        readyState: audio.readyState,
      })) {
        startChip('Source audio stalled — browser pattern fallback active', 'fallback')
        return
      }
      setReferenceStarting(false)
      setReferencePlaying(true)
      setMessage(chipPurposeRef.current === 'layered' ? 'Playing layered edit mix' : 'Playing original recording')
    }, SOURCE_STALL_GRACE_MS)
  }, [clearSourceWatchdog, startChip])

  const startLayeredPreview = useCallback((looping = false) => {
    const audio = audioRef.current
    if (!audio) {
      startChip('Source audio unavailable — full chip fallback active', 'fallback')
      return
    }

    stopChip()
    pauseReference()
    broadcastPlayback()
    void engine.unlock()
    chipPurposeRef.current = 'layered'
    setChipPurpose('layered')
    previewModeRef.current = 'chip'
    setPreviewMode('chip')

    const startRow = looping ? 0 : chipStartRowRef.current
    const resumeTime = looping ? null : layeredResumeTimeRef.current
    layeredResumeTimeRef.current = null
    const rowDuration = 60 / project.tempo / 4
    configureReferenceAudio(audio, LAYERED_BACKING_VOLUME, sourcePlaybackRate(project.sourceSync, project.tempo))
    audio.currentTime = resumeTime ?? sourceTimeForRow(startRow, project.sourceSync, project.tempo, project.rows)
    setPlayhead(startRow)
    chipStartRowRef.current = startRow

    const attempt = sourceAttemptRef.current + 1
    sourceAttemptRef.current = attempt
    setReferenceStarting(true)
    setReferencePlaying(false)
    setPlaying(true)
    setMessage(looping ? 'Looping layered edit mix' : 'Starting layered edit mix…')

    const startOverlay = () => {
      if (sourceAttemptRef.current !== attempt || chipPurposeRef.current !== 'layered' || timerRef.current !== null) return
      let lastRow = -1
      const tick = () => {
        if (sourceAttemptRef.current !== attempt || chipPurposeRef.current !== 'layered') return
        const row = Math.floor(sourceRowPosition(audio.currentTime, project.sourceSync, project.tempo, project.rows)) % project.rows
        if (row === lastRow) return
        lastRow = row
        setPlayhead(row)
        chipStartRowRef.current = row
        const editedCells = channels.filter((channel) => project.cells[channel.id][row].edited)
        audio.volume = editedCells.length ? LAYERED_EDIT_DUCK_VOLUME : LAYERED_BACKING_VOLUME
        editedCells.forEach((channel) => {
          if (!muted.has(channel.id)) engine.play(project.cells[channel.id][row], channel, rowDuration * 0.9)
        })
      }
      tick()
      timerRef.current = window.setInterval(tick, 16)
    }

    const initialTime = audio.currentTime
    try {
      void Promise.resolve(audio.play()).then(() => {
        if (sourceAttemptRef.current !== attempt) return
        startOverlay()
        armSourceWatchdog(attempt, initialTime)
      }).catch(() => {
        if (sourceAttemptRef.current === attempt) startChip('Source audio was blocked — full chip fallback active', 'fallback')
      })
    } catch {
      if (sourceAttemptRef.current === attempt) startChip('Source audio was blocked — full chip fallback active', 'fallback')
    }
  }, [armSourceWatchdog, broadcastPlayback, muted, pauseReference, project, startChip, stopChip])

  const beginSourcePlayback = useCallback((looping = false) => {
    const audio = audioRef.current
    if (!audio) {
      startChip('Source audio unavailable — browser pattern fallback active', 'fallback')
      return
    }
    stopChip()
    clearSourceWatchdog()
    const attempt = sourceAttemptRef.current + 1
    sourceAttemptRef.current = attempt
    setReferenceStarting(true)
    setReferencePlaying(false)
    setMessage(looping ? 'Looping original recording' : 'Starting original recording…')
    broadcastPlayback()
    void engine.unlock()
    configureReferenceAudio(audio)
    const offset = sourceLoopStart(project.sourceSync)
    if (looping || audio.ended || (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration - 0.05) || audio.currentTime < offset) {
      audio.currentTime = offset
    }
    const initialTime = audio.currentTime
    try {
      void Promise.resolve(audio.play()).then(() => {
        if (sourceAttemptRef.current === attempt) armSourceWatchdog(attempt, initialTime)
      }).catch(() => {
        if (sourceAttemptRef.current === attempt) startChip('Source audio was blocked — browser pattern fallback active', 'fallback')
      })
    } catch {
      if (sourceAttemptRef.current === attempt) startChip('Source audio was blocked — browser pattern fallback active', 'fallback')
    }
  }, [armSourceWatchdog, broadcastPlayback, clearSourceWatchdog, project.sourceSync, startChip, stopChip])

  const selectTrack = (track: LibraryTrack) => {
    if (track.id === selectedId) return
    if (saveStatus === 'dirty' && !window.confirm('Discard the unsaved tracker changes and open another tune?')) return
    const nextProject = loadProject(track)
    const nextPreviewRow = projectPreviewRow(nextProject)
    const nextMode: PreviewMode = nextPreviewRow !== null ? 'chip' : track.audio ? 'source' : 'chip'
    stopEverything()
    layeredResumeTimeRef.current = null
    setSelectedId(track.id)
    setProject(nextProject)
    setUndoStack([])
    setRedoStack([])
    setPlayhead(nextPreviewRow ?? 0)
    setSelectedRow(0)
    setSelectedChannel('pulse1')
    setCellSelection({ anchor: { channelId: 'pulse1', row: 0 }, focus: { channelId: 'pulse1', row: 0 } })
    setView('tracker')
    setMuted(new Set())
    setEditing(false)
    previewModeRef.current = nextMode
    chipStartRowRef.current = nextPreviewRow ?? 0
    setPreviewMode(nextMode)
    setLastEditedRow(nextPreviewRow)
    setSaveStatus(browserStorage() ? 'saved' : 'temporary')
    setLastSavedAt(null)
    window.history.replaceState(null, '', `#${track.slug}`)
    setMessage(`Loaded ${track.shortTitle}`)
  }

  useEffect(() => () => stopEverything(), [stopEverything])

  useEffect(() => {
    const handleSignal = (value: unknown) => {
      if (!isPlaybackSignal(value) || value.tabId === tabIdRef.current || !playbackActiveRef.current) return
      stopEverything('Paused because another Chipvault tab started playback')
    }
    let channel: BroadcastChannel | null = null
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        channel = new BroadcastChannel('n9nes9-chipvault-playback')
        channel.onmessage = (event) => handleSignal(event.data)
        playbackChannelRef.current = channel
      }
    } catch {
      playbackChannelRef.current = null
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PLAYBACK_SIGNAL_KEY || !event.newValue) return
      try { handleSignal(JSON.parse(event.newValue)) } catch { /* ignore malformed cross-tab data */ }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('storage', onStorage)
      channel?.close()
      if (playbackChannelRef.current === channel) playbackChannelRef.current = null
    }
  }, [stopEverything])

  useEffect(() => {
    let disposed = false
    const checkForUpdate = async () => {
      const manifest = await fetchBuildManifest(import.meta.env.BASE_URL)
      if (disposed) return
      const action = buildUpdateAction(manifest?.build, {
        playbackActive: playbackActiveRef.current,
        editing: false,
        storageHealthy: true,
      })
      if (action === 'reload' && manifest?.build) {
        const url = new URL(window.location.href)
        if (url.searchParams.get('build') === manifest.build) {
          setUpdateReady(true)
        } else {
          url.searchParams.set('build', manifest.build)
          window.location.replace(url)
        }
      } else if (action === 'notify') {
        setUpdateReady(true)
      }
    }
    const reconcileReferenceState = () => {
      const audio = audioRef.current
      const active = Boolean(audio && !audio.paused && !audio.ended)
      if (active) setReferenceStarting(false)
      setReferencePlaying((current) => current === active ? current : active)
    }
    const onVisibilityChange = () => {
      if (document.hidden) {
        stopEverything('Paused while this tab was inactive')
      } else {
        reconcileReferenceState()
        syncReference()
        void checkForUpdate()
      }
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) stopEverything('Restored safely from browser history')
      void checkForUpdate()
    }
    const onFocus = () => { void checkForUpdate() }
    const onOnline = () => { void checkForUpdate() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    const updateInterval = window.setInterval(() => { if (!document.hidden) void checkForUpdate() }, 30_000)
    const mediaInterval = window.setInterval(() => { if (!document.hidden) reconcileReferenceState() }, 500)
    void checkForUpdate()
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      window.clearInterval(updateInterval)
      window.clearInterval(mediaInterval)
    }
  }, [stopEverything, syncReference])

  const setNotes = useCallback((targets: GridPoint[], note: string | null) => {
    if (!editing || !targets.length) return
    const firstRow = Math.min(...targets.map((target) => target.row))
    const auditionTarget = targets[targets.length - 1]
    const previous = project.cells[auditionTarget.channelId][auditionTarget.row]
    commitPreviewEdit((draft) => {
      targets.forEach((target) => {
        const cell = draft.cells[target.channelId][target.row]
        cell.note = note
        if (note) {
          cell.instrument ??= target.channelId.startsWith('vrc6') ? 1 : 0
          cell.volume ??= 15
        } else {
          cell.instrument = null
          cell.volume = null
          cell.effect = ''
        }
        cell.edited = true
      })
    }, firstRow, note
      ? `${note} applied to ${targets.length} cell${targets.length === 1 ? '' : 's'}`
      : `${targets.length} selected cell${targets.length === 1 ? '' : 's'} cleared`)
    setSelectedChannel(auditionTarget.channelId)
    setSelectedRow(auditionTarget.row)
    const channel = channels.find((candidate) => candidate.id === auditionTarget.channelId)
    if (note && channel && !playbackActiveRef.current) {
      void engine.unlock().then((unlocked) => {
        if (!unlocked || playbackActiveRef.current) return
        engine.play({ ...previous, note, instrument: previous.instrument ?? 0, volume: previous.volume ?? 12, edited: true }, channel, 0.22)
      })
    }
  }, [commitPreviewEdit, editing, project.cells])

  const setNote = useCallback((channelId: ChannelId, row: number, note: string | null) => {
    selectSingleCell(channelId, row)
    setNotes([{ channelId, row }], note)
  }, [selectSingleCell, setNotes])

  const setSelectionNote = useCallback((note: string | null) => {
    setNotes(selectedTargets, note)
  }, [selectedTargets, setNotes])

  const editSelection = useCallback((mutate: (cell: TrackerProject['cells'][ChannelId][number]) => void, detail: string) => {
    if (!editing || !selectedTargets.length || !selectedBounds) return
    commitPreviewEdit((draft) => {
      selectedTargets.forEach((target) => {
        const cell = draft.cells[target.channelId][target.row]
        mutate(cell)
        cell.edited = true
      })
    }, selectedBounds.firstRow, `${detail} on ${selectedTargets.length} cell${selectedTargets.length === 1 ? '' : 's'}`)
  }, [commitPreviewEdit, editing, selectedBounds, selectedTargets])

  useEffect(() => {
    const keys = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k']
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      const trackerCell = target.closest('.tracker-table tbody td button')
      if (target.matches('input, select, textarea, audio') || (target.matches('button') && !trackerCell)) return
      if (event.code === 'Space') { event.preventDefault(); toggleTransport(); return }
      if (!editing) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        setSelectionNote(null)
        return
      }
      if (event.key.toLowerCase() === 'z') { setOctave((value) => Math.max(1, value - 1)); return }
      if (event.key.toLowerCase() === 'x') { setOctave((value) => Math.min(7, value + 1)); return }
      const semitone = keys.indexOf(event.key.toLowerCase())
      if (semitone >= 0) {
        event.preventDefault()
        setSelectionNote(midiToNote((octave + 1) * 12 + semitone))
        if (selectedTargets.length === 1) selectSingleCell(selectedChannel, Math.min(project.rows - 1, selectedRow + 1))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editing, octave, project.rows, selectSingleCell, selectedChannel, selectedRow, selectedTargets.length, setSelectionNote, toggleTransport])

  const undo = () => {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return
    setRedoStack((stack) => [...stack, cloneProject(project)])
    setUndoStack((stack) => stack.slice(0, -1))
    setSaveStatus('dirty')
    setProject(previous)
    armEditedPreview(selectedRow, 'Undo applied')
  }

  const redo = () => {
    const next = redoStack[redoStack.length - 1]
    if (!next) return
    setUndoStack((stack) => [...stack, cloneProject(project)])
    setRedoStack((stack) => stack.slice(0, -1))
    setSaveStatus('dirty')
    setProject(next)
    armEditedPreview(selectedRow, 'Redo applied')
  }

  const onImport = async (file: File) => {
    try {
      const text = await file.text()
      const imported = file.name.toLowerCase().endsWith('.txt')
        ? importFamiTrackerText(text, selectedTrack.id)
        : parseProject(text)
      const shippedRevision = recoveredProjectForTrack(selectedTrack)?.contentRevision ?? 0
      setUndoStack((stack) => [...stack, cloneProject(project)])
      setProject({ ...imported, sourceId: selectedTrack.id, contentRevision: Math.max(imported.contentRevision, shippedRevision + 1), previewStartRow: 0 })
      setSaveStatus('dirty')
      armEditedPreview(0, `Imported ${file.name}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed')
    }
  }

  const exportNative = () => {
    downloadText(filename(project.title, 'chipvault.json'), serializeProject(project), 'application/json')
    setMessage('Downloaded clean pattern project')
  }

  const exportFami = () => {
    downloadText(filename(project.title, 'famitracker.txt'), exportFamiTrackerText(project), 'text/plain')
    setMessage('Downloaded FamiTracker module · use File → Import text…')
  }

  const handleReferencePlaying = () => {
    clearSourceWatchdog()
    const layered = chipPurposeRef.current === 'layered'
    if (!layered) {
      stopChip()
      if (audioRef.current) configureReferenceAudio(audioRef.current)
    }
    setReferenceStarting(false)
    setReferencePlaying(true)
    broadcastPlayback()
    setMessage(layered ? 'Playing layered edit mix' : 'Playing original recording')
  }

  const handleReferencePause = () => {
    if (internalPauseRef.current) {
      internalPauseRef.current = false
      return
    }
    sourceAttemptRef.current += 1
    clearSourceWatchdog()
    setReferenceStarting(false)
    setReferencePlaying(false)
    if (chipPurposeRef.current === 'layered' && !audioRef.current?.ended) {
      layeredResumeTimeRef.current = audioRef.current?.currentTime ?? null
      stopChip('Paused')
      if (audioRef.current) configureReferenceAudio(audioRef.current)
    }
  }

  const handleReferenceWaiting = () => {
    if (!referenceActive) return
    const audio = audioRef.current
    if (!audio) return
    setMessage(chipPurposeRef.current === 'layered' ? 'Re-syncing layered edit mix…' : 'Buffering original recording…')
    armSourceWatchdog(sourceAttemptRef.current, audio.currentTime)
  }

  const handleReferenceEnded = () => {
    const endedPurpose = chipPurposeRef.current
    clearSourceWatchdog()
    setReferenceStarting(false)
    setReferencePlaying(false)
    if (shouldRestartSource(project.loop, document.hidden) && (previewMode === 'source' || endedPurpose === 'layered')) {
      if (endedPurpose === 'layered') startLayeredPreview(true)
      else beginSourcePlayback(true)
    } else {
      sourceAttemptRef.current += 1
      if (endedPurpose === 'layered') stopChip('Layered edit mix finished')
      else setMessage('Recording finished')
    }
  }

  const handleReferenceError = () => {
    if (referenceActive || chipPurposeRef.current === 'layered') startChip('Source audio failed — browser pattern fallback active', 'fallback')
    else setMessage('Source recording could not load in this browser')
  }

  function toggleTransport() {
    if (playbackActive) {
      if (chipPurposeRef.current === 'layered') layeredResumeTimeRef.current = audioRef.current?.currentTime ?? null
      stopEverything('Paused')
      return
    }
    if (previewMode === 'source' && audioRef.current) beginSourcePlayback()
    else if (hasLayeredPreview) startLayeredPreview()
    else startChip(selectedTrack.kind === 'bonus' ? 'Playing browser chiptune arrangement' : 'Playing browser pattern')
  }

  const setEditMode = (next: boolean) => {
    if (next === editing) return
    if (!next && saveStatus === 'dirty') {
      setMessage('Unsaved changes · use Save & Play before leaving Edit')
      return
    }
    stopEverything()
    setEditing(next)
    if (next) {
      const savedEditRow = projectPreviewRow(project)
      const mode: PreviewMode = selectedTrack.audio && savedEditRow === null ? 'source' : 'chip'
      previewModeRef.current = mode
      setPreviewMode(mode)
      if (savedEditRow !== null) {
        chipStartRowRef.current = savedEditRow
        setLastEditedRow(savedEditRow)
        setPlayhead(savedEditRow)
      }
      setMessage(mode === 'source'
        ? 'Editing · original recording selected · the first change will arm Layered edit mix'
        : `Editing saved chiptune${savedEditRow === null ? '' : selectedTrack.audio ? ' · Layered edit mix restored at the last changed row' : ' · Edited preview restored at the last changed row'}`)
    } else {
      const savedEditRow = projectPreviewRow(project)
      const mode: PreviewMode = savedEditRow !== null ? 'chip' : selectedTrack.audio ? 'source' : 'chip'
      previewModeRef.current = mode
      setPreviewMode(mode)
      setMessage(mode === 'chip' ? 'Play mode · saved edited pattern selected' : 'Play mode · original recording selected')
    }
  }

  const choosePreview = (next: PreviewMode) => {
    if (next === 'source' && !selectedTrack.audio) return
    previewModeRef.current = next
    layeredResumeTimeRef.current = null
    stopEverything()
    setPreviewMode(next)
    if (next === 'chip') {
      const startRow = lastEditedRow ?? playhead
      chipStartRowRef.current = startRow
      setPlayhead(startRow)
    }
    setMessage(next === 'source'
      ? 'Original recording selected · authentic mix, edits remain visible'
      : `${hasLayeredPreview ? 'Layered edit mix' : 'Edited chip preview'} selected${editedStartLabel ? ` · starts at ${editedStartLabel}` : ''}`)
  }

  const setEditorView = (next: ViewMode) => {
    if (next === view) return
    stopEverything()
    setView(next)
    if (next === 'tracker') {
      setCellSelection({ anchor: { channelId: selectedChannel, row: selectedRow }, focus: { channelId: selectedChannel, row: selectedRow } })
    }
    setMessage(next === 'tracker' ? 'Tracker grid ready' : 'Piano roll ready')
  }

  const returnToStart = () => {
    stopEverything()
    if (audioRef.current) audioRef.current.currentTime = project.sourceSync?.audioOffset ?? 0
    chipStartRowRef.current = 0
    layeredResumeTimeRef.current = null
    setPlayhead(0)
    setMessage('Returned to first row')
  }

  const reset = () => {
    if (!window.confirm(`Reset local edits for “${selectedTrack.shortTitle}”?`)) return
    setUndoStack((stack) => [...stack, cloneProject(project)])
    setSaveStatus('dirty')
    setProject(recoveredProjectForTrack(selectedTrack) ?? createDraft(selectedTrack))
    armEditedPreview(0, 'Restored the clean recovery baseline')
  }

  const reloadCurrentBuild = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('build', Date.now().toString())
    window.location.replace(url)
  }

  return (
    <div className="app-shell" data-release-mode="viewer-only">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="N9NES9 Chipvault home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span><b>N9NES9</b><em>CHIPVAULT</em></span>
        </a>
        <div className="topbar-status"><span className="live-dot" /> View-only archive · 18 clean patterns</div>
        <button className="ghost-button" onClick={() => setAboutOpen(true)}>About the recovery</button>
      </header>

      <aside className="library-panel" aria-label="Track library">
        <div className="library-heading">
          <p className="eyebrow">Archive / 2012</p>
          <h1>The old tapes,<br />back on the grid.</h1>
          <p>Original uploads, preserved audio, and honest recovery drafts.</p>
        </div>
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a track" aria-label="Find a track" />
        </label>
        <div className="filter-row" aria-label="Filter tracks">
          {(['all', 'original', 'cover', 'demo', 'bonus'] as Filter[]).map((item) => (
            <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>
          ))}
        </div>
        <div className="track-list">
          {filtered.map((track, index) => (
            <button key={track.id} className={`track-item ${track.kind === 'bonus' ? 'bonus-track' : ''} ${selectedId === track.id ? 'selected' : ''}`} onClick={() => selectTrack(track)}>
              <span className="track-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="track-copy"><b>{track.shortTitle}</b><small>{track.kind} · {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}</small></span>
              <span className="track-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="studio" id="top">
        {updateReady && <button className="update-toast" onClick={reloadCurrentBuild}><strong>Fresh build ready</strong><span>Reload the tracker cleanly →</span></button>}
        <section className="hero-card">
          <img src={asset(selectedTrack.poster)} alt="" />
          <div className="hero-copy">
            <div className="badge-row"><span className={`kind-badge ${selectedTrack.kind}`}>{selectedTrack.kind}</span><span>{selectedTrack.expansion}</span><span>{selectedTrack.uploaded.slice(0, 4)}</span></div>
            <h2>{selectedTrack.shortTitle}</h2>
            <p>{selectedTrack.description}</p>
            {selectedTrack.credit && <p className="credit">{selectedTrack.credit}</p>}
            <div className="workspace-mode viewer-only" aria-label="Workspace mode">
              <div className="viewer-mode"><span>View only</span><small>clean archive playback</small></div>
              <details className="export-menu mode-export"><summary>Download</summary><div><button onClick={exportNative}>Clean pattern JSON</button><button onClick={exportFami}>FamiTracker TXT · Import text…</button>{selectedTrack.audio && <a href={asset(selectedTrack.audio)} download={`${selectedTrack.slug}.m4a`}>Source audio M4A</a>}</div></details>
            </div>
            {selectedTrack.audio && <div className="source-player">
              <audio ref={audioRef} key={selectedTrack.id} src={asset(selectedTrack.audio)} controls preload="auto" playsInline onPlaying={handleReferencePlaying} onPause={handleReferencePause} onWaiting={handleReferenceWaiting} onStalled={handleReferenceWaiting} onEnded={handleReferenceEnded} onError={handleReferenceError} onTimeUpdate={syncReference} />
              <a className="youtube-link" href={selectedTrack.sourceUrl} target="_blank" rel="noreferrer">Original upload ↗</a>
            </div>}
            {selectedTrack.kind === 'bonus' && <div className="bonus-source"><span>Browser chiptune arrangement</span><a href={selectedTrack.sourceUrl} target="_blank" rel="noreferrer">Reference performance ↗</a></div>}
          </div>
        </section>

        <section className={`recovery-banner ${project.recoveryStatus}`}>
          <span className="warning-icon" aria-hidden="true">!</span>
          {project.recoveryStatus === 'pattern-recovered' ? (
            <div><strong>Animated pattern recovered from the video · {Math.round((project.sourceSync?.confidence ?? 0) * 100)}% transcription confidence</strong><p>{project.rows / project.patternLength} visible FamiTracker orders are synchronised to the original recording. Hidden instrument envelopes remain reconstructed, not original.</p></div>
          ) : project.recoveryStatus === 'audio-transcribed' ? (
            <div><strong>Audio-derived pattern view · {Math.round((project.sourceSync?.confidence ?? 0) * 100)}% pitch confidence</strong><p>Dominant notes, bass, harmony, and rhythm were extracted from the preserved mix. It is populated for viewing, but it is not claimed to be the lost original channel data.</p></div>
          ) : project.recoveryStatus === 'arranged-cover' ? (
            <div><strong>VRC6-style chiptune arrangement · ten-minute session</strong><p>The recognizable sax riff, harmony, bass, and drums are synthesized by the browser tracker and shown as clean pattern data.</p></div>
          ) : (
            <div><strong>Recovery draft — original module not yet found</strong><p>The recording is authentic. Pattern data remains view-only until an original FTM is recovered.</p></div>
          )}
          <button onClick={() => setAboutOpen(true)}>Why?</button>
        </section>

        <section className="workbench" data-transport={transportMode} data-preview={previewMode} data-backing-active="false" data-mode="viewer-only">
          <div className="transport-bar">
            <div className="transport-buttons">
              <button className="play-button" onClick={toggleTransport} aria-label={playbackActive ? `Pause ${playbackName}` : `Play ${playbackName}`} title={playbackActive ? `Pause ${playbackName}` : `Play ${playbackName}`}>{playbackActive ? '■' : '▶'}</button>
              <button onClick={returnToStart} aria-label="Return to first row">↤</button>
            </div>
            <span className="transport-readout">{project.tempo} BPM</span>
            <span className="transport-readout">Speed {project.speed}</span>
            <span className="transport-readout">{project.loop ? 'Loop on' : 'One pass'}</span>
            <div className="transport-spacer" />
            <span className="viewer-release"><i /> View only · clean shipped pattern</span>
          </div>

          <div className="editor-tabs">
            <div role="tablist" aria-label="Pattern view">
              <button role="tab" aria-selected={view === 'tracker'} className={view === 'tracker' ? 'active' : ''} onClick={() => setEditorView('tracker')}>Tracker</button>
              <button role="tab" aria-selected={view === 'piano'} className={view === 'piano' ? 'active' : ''} onClick={() => setEditorView('piano')}>Piano roll</button>
            </div>
          </div>

          {view === 'tracker' ? (
            <TrackerGrid project={project} playhead={playhead} referenceAudioRef={audioRef} referenceActive={referenceActive} chipPlaying={playing} selectedChannel={selectedChannel} selectedRow={selectedRow} selectedCellKeys={selectedCellKeys} muted={muted} editing={EDITING_ENABLED} onMute={(id) => setMuted((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })} onSelectionStart={beginCellSelection} onSelectionMove={extendCellSelection} onSelectionEnd={endCellSelection} onClearSelection={() => undefined} />
          ) : (
            <PianoRoll project={project} channelId={selectedChannel} selectedRow={selectedRow} editing={EDITING_ENABLED} onChannel={setSelectedChannel} onSetNote={() => undefined} />
          )}

          <div className="entry-strip viewing">
            <div><span className="eyebrow">Pattern viewer</span><strong>{channels.find((channel) => channel.id === selectedChannel)?.name} · row {selectedRow.toString(16).padStart(2, '0').toUpperCase()}</strong></div>
            <div className="view-mode-copy"><strong>Fixed playhead · moving clean pattern</strong><span>Editing and local project memory are temporarily disabled. Archived tracks play only their preserved recording.</span></div>
          </div>
        </section>
        <footer><span>{message}</span><span>View-only build {BUILD_ID} · no local project memory</span></footer>
      </main>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  )
}

function TrackerGrid({ project, playhead, referenceAudioRef, referenceActive, chipPlaying, selectedChannel, selectedRow, selectedCellKeys, muted, editing, onMute, onSelectionStart, onSelectionMove, onSelectionEnd, onClearSelection }: {
  project: TrackerProject
  playhead: number
  referenceAudioRef: React.RefObject<HTMLAudioElement | null>
  referenceActive: boolean
  chipPlaying: boolean
  selectedChannel: ChannelId
  selectedRow: number
  selectedCellKeys: Set<string>
  muted: Set<ChannelId>
  editing: boolean
  onMute: (id: ChannelId) => void
  onSelectionStart: (id: ChannelId, row: number, extend: boolean) => void
  onSelectionMove: (id: ChannelId, row: number) => void
  onSelectionEnd: () => void
  onClearSelection: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const firstRowRef = useRef<HTMLTableRowElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)

  const updatePosition = useCallback((position: number, smooth = false) => {
    const container = scrollRef.current
    const firstRow = firstRowRef.current
    if (!container || !firstRow) return
    const rowHeight = firstRow.offsetHeight
    const headerHeight = 50
    const viewportCentre = headerHeight + (container.clientHeight - headerHeight) / 2
    const top = firstRow.offsetTop + position * rowHeight + rowHeight / 2 - viewportCentre
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    container.scrollTo({ top, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' })
    const row = Math.floor(position) % project.rows
    const order = Math.floor(row / project.patternLength).toString(16).padStart(2, '0').toUpperCase()
    const patternRow = (row % project.patternLength).toString(16).padStart(2, '0').toUpperCase()
    if (playheadRef.current) {
      playheadRef.current.dataset.position = position.toFixed(3)
      const label = playheadRef.current.querySelector('span')
      if (label) label.textContent = `${order}:${patternRow}`
    }
  }, [project.patternLength, project.rows])

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!referenceActive || reduceMotion) updatePosition(playhead, chipPlaying)
  }, [chipPlaying, playhead, referenceActive, updatePosition])

  useEffect(() => {
    if (!referenceActive) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const animate = () => {
      const audio = referenceAudioRef.current
      if (!audio) return
      updatePosition(sourceRowPosition(audio.currentTime, project.sourceSync, project.tempo, project.rows))
      frame = window.requestAnimationFrame(animate)
    }
    frame = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frame)
  }, [project.rows, project.sourceSync, project.tempo, referenceActive, referenceAudioRef, updatePosition])

  return (
    <div className={`tracker-scroll ${referenceActive || chipPlaying ? 'is-playing' : ''}`} ref={scrollRef}>
      <div className="tracker-playhead" ref={playheadRef} data-position={playhead.toFixed(3)} aria-hidden="true"><i /><span>00:00</span></div>
      <table className="tracker-table">
        <thead><tr><th>ROW</th>{channels.map((channel) => <th key={channel.id} style={{ '--channel': channel.color } as React.CSSProperties}><button onClick={() => onMute(channel.id)} className={muted.has(channel.id) ? 'muted' : ''}><span>{channel.short}</span><small>{muted.has(channel.id) ? 'muted' : channel.name}</small></button></th>)}</tr></thead>
        <tbody><tr className="tracker-spacer-row" aria-hidden="true"><td colSpan={channels.length + 1} /></tr>{Array.from({ length: project.rows }, (_, row) => (
          <tr key={row} ref={row === 0 ? firstRowRef : undefined} className={playhead === row ? 'playing-row' : ''}>
            <th>{Math.floor(row / project.patternLength).toString(16).padStart(2, '0').toUpperCase()}:{(row % project.patternLength).toString(16).padStart(2, '0').toUpperCase()}</th>
            {channels.map((channel) => {
              const cell = project.cells[channel.id][row]
              const selected = channel.id === selectedChannel && row === selectedRow
              const rangeSelected = selectedCellKeys.has(cellKey(channel.id, row))
              const instrument = cell.instrument !== null ? cell.instrument.toString(16).padStart(2, '0').toUpperCase() : '..'
              const volume = cell.volume !== null ? cell.volume.toString(16).toUpperCase() : '.'
              const effects = cell.effects?.length ? cell.effects : [cell.effect || '...']
              return <td key={channel.id} style={{ '--channel': channel.color } as React.CSSProperties}><button data-grid-channel={channel.id} data-grid-row={row} aria-label={`${channel.name}, row ${row}${rangeSelected ? ', selected' : ''}${cell.edited ? ', user edited' : ''}`} aria-pressed={rangeSelected} className={`${selected ? 'selected-cell' : ''} ${rangeSelected ? 'range-selected' : ''} ${cell.edited ? 'user-edited' : ''}`} onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); onSelectionStart(channel.id, row, event.shiftKey) }} onPointerOver={() => { if (editing) onSelectionMove(channel.id, row) }} onPointerUp={onSelectionEnd} onDoubleClick={(event) => { if (editing && rangeSelected) { event.preventDefault(); onClearSelection() } }} onContextMenu={(event) => { if (editing && rangeSelected) { event.preventDefault(); onClearSelection() } }}>
                <b className={`note-token ${cell.note ? '' : 'empty-token'}`}>{cell.note ?? '...'}</b>
                <span className="cell-fields"><i className={`instrument-token ${instrument === '..' ? 'empty-token' : ''}`}>{instrument}</i><i className={`volume-token ${volume === '.' ? 'empty-token' : ''}`}>{volume}</i><span className="effect-columns">{effects.map((effect, index) => <i key={`${index}-${effect}`} className={`effect-token ${effect === '...' ? 'empty-token' : ''}`}>{effect}</i>)}</span></span>
                {cell.edited && <em className="edit-marker">EDIT</em>}
              </button></td>
            })}
          </tr>
        ))}<tr className="tracker-spacer-row" aria-hidden="true"><td colSpan={channels.length + 1} /></tr></tbody>
      </table>
    </div>
  )
}

function PianoRoll({ project, channelId, selectedRow, editing, onChannel, onSetNote }: {
  project: TrackerProject
  channelId: ChannelId
  selectedRow: number
  editing: boolean
  onChannel: (id: ChannelId) => void
  onSetNote: (id: ChannelId, row: number, note: string | null) => void
}) {
  const pitches = Array.from({ length: 36 }, (_, index) => midiToNote(83 - index))
  const notesByRow = new Map(project.cells[channelId].map((cell, row) => [row, cell.note]))
  const editedRows = new Set(project.cells[channelId].reduce<number[]>((rows, cell, row) => {
    if (cell.edited) rows.push(row)
    return rows
  }, []))
  return (
    <div className="piano-editor">
      <div className="piano-toolbar"><label>Channel<select value={channelId} onChange={(event) => onChannel(event.target.value as ChannelId)}>{channels.map((channel) => <option value={channel.id} key={channel.id}>{channel.name}</option>)}</select></label><span>View only · clean shipped pattern</span></div>
      <div className="piano-scroll">
        <div className="piano-grid" style={{ '--rows': project.rows } as React.CSSProperties}>
          {pitches.map((note) => <div className="piano-line" key={note}><span className={note.includes('#') ? 'black-key' : ''}>{note}</span><div className="piano-cells">{Array.from({ length: project.rows }, (_, row) => <button key={row} disabled={!editing} aria-label={`${note} at row ${row}${editedRows.has(row) ? ', user edited' : ''}`} className={`${notesByRow.get(row) === note ? 'placed' : ''} ${selectedRow === row ? 'selected-column' : ''} ${editedRows.has(row) ? 'user-edited' : ''}`} onClick={() => onSetNote(channelId, row, notesByRow.get(row) === note ? null : note)} />)}</div></div>)}
        </div>
      </div>
    </div>
  )
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="dialog-close" onClick={onClose} aria-label="Close">×</button>
        <p className="eyebrow">Recovery notes</p>
        <h2 id="about-title">The audio survived.<br />The visible patterns can too.</h2>
        <p>YouTube stores the finished mix rather than an FTM file, but these uploads also recorded the FamiTracker grid. Chipvault can transcribe visible notes, instruments, effects, and order boundaries from those frames.</p>
        <p>Hidden instrument macros still have to be reconstructed and every result is confidence-labelled. Game Complete Loop retains its frame-recovered data; the other preserved mixes now open populated audio-derived drafts instead of blank grids.</p>
        <div className="dialog-facts"><div><strong>18</strong><span>pattern views</span></div><div><strong>8</strong><span>NES + VRC6 channels</span></div><div><strong>0</strong><span>blank track baselines</span></div></div>
        <button className="primary-action dialog-action" onClick={onClose}>Back to the archive</button>
      </section>
    </div>
  )
}

export default App
