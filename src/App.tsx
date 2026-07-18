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
  preferShippedBaseline,
  serializeProject,
} from './lib/project'
import { buildUpdateAction, BUILD_ID, fetchBuildManifest } from './lib/versioning'
import { browserStorage, safeStorageGet, safeStorageSet } from './lib/reliability'
import {
  createPlaybackSignal,
  isPlaybackSignal,
  PLAYBACK_SIGNAL_KEY,
  shouldRestartSource,
  SOURCE_STALL_GRACE_MS,
  sourceLoopStart,
  sourceNeedsFallback,
  sourceRowPosition,
} from './lib/playback'
import type { ChannelId, LibraryTrack, TrackerProject } from './types'

type ViewMode = 'tracker' | 'piano'
type Filter = 'all' | 'original' | 'cover' | 'demo' | 'bonus'
type PreviewMode = 'source' | 'chip'
type ChipPurpose = 'preview' | 'fallback'
type SaveStatus = 'saving' | 'saved' | 'temporary'

const engine = new ChipAudioEngine()
const storageKey = (id: string) => `n9nes9-chipvault:${id}`
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`

function loadProject(track: LibraryTrack): TrackerProject {
  const recovered = recoveredProjectForTrack(track)
  const stored = safeStorageGet(browserStorage(), storageKey(track.id))
  if (!stored) return recovered ?? createDraft(track)
  try {
    const saved = parseProject(stored)
    return preferShippedBaseline(saved, recovered)
  } catch {
    return recovered ?? createDraft(track)
  }
}

function filename(title: string, extension: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.${extension}`
}

function App() {
  const defaultTrack = library.find((track) => track.recoveryStatus === 'pattern-recovered') ?? library[0]
  const initialTrack = library.find((track) => `#${track.slug}` === window.location.hash) ?? defaultTrack
  const [selectedId, setSelectedId] = useState(initialTrack.id)
  const selectedTrack = library.find((track) => track.id === selectedId) ?? library[0]
  const [project, setProject] = useState(() => loadProject(initialTrack))
  const [undoStack, setUndoStack] = useState<TrackerProject[]>([])
  const [redoStack, setRedoStack] = useState<TrackerProject[]>([])
  const [view, setView] = useState<ViewMode>('tracker')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<ChannelId>('pulse1')
  const [selectedRow, setSelectedRow] = useState(0)
  const [octave, setOctave] = useState(4)
  const [playing, setPlaying] = useState(false)
  const [referenceStarting, setReferenceStarting] = useState(false)
  const [referencePlaying, setReferencePlaying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [previewMode, setPreviewMode] = useState<PreviewMode>(initialTrack.audio ? 'source' : 'chip')
  const [chipPurpose, setChipPurpose] = useState<ChipPurpose | null>(null)
  const [playhead, setPlayhead] = useState(0)
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
  const sourceWatchdogRef = useRef<number | null>(null)
  const playbackChannelRef = useRef<BroadcastChannel | null>(null)
  const tabIdRef = useRef(`tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`)
  const playbackActiveRef = useRef(false)
  const editingRef = useRef(editing)
  const storageHealthyRef = useRef(storageHealthy)

  const filtered = useMemo(() => library.filter((track) => {
    const matchesFilter = filter === 'all' || track.kind === filter
    const haystack = `${track.shortTitle} ${track.description} ${track.credit ?? ''}`.toLowerCase()
    return matchesFilter && haystack.includes(query.trim().toLowerCase())
  }), [filter, query])
  const selectedCell = project.cells[selectedChannel][selectedRow]
  const editedCount = useMemo(() => channels.reduce((total, channel) => (
    total + project.cells[channel.id].filter((cell) => cell.edited).length
  ), 0), [project])
  const referenceActive = referenceStarting || referencePlaying
  const playbackActive = playing || referenceActive
  const transportMode = playing ? (chipPurpose === 'fallback' ? 'chip-fallback' : 'chip-preview') : referencePlaying ? 'source-playing' : referenceStarting ? 'source-starting' : 'idle'
  const playbackName = editing && previewMode === 'chip' ? 'edited chip preview' : selectedTrack.audio ? 'original recording' : 'edited chip preview'
  const savedTime = lastSavedAt === null ? null : new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const saveText = saveStatus === 'temporary'
    ? 'Not saved · export to keep'
    : saveStatus === 'saving'
      ? 'Saving in this browser…'
      : `Saved in this browser${savedTime ? ` · ${savedTime}` : ''} · ${editedCount} edit${editedCount === 1 ? '' : 's'}`

  useEffect(() => {
    playbackActiveRef.current = playbackActive
    editingRef.current = editing
    storageHealthyRef.current = storageHealthy
  }, [editing, playbackActive, storageHealthy])

  const commit = useCallback((mutate: (draft: TrackerProject) => void) => {
    setSaveStatus(storageHealthyRef.current ? 'saving' : 'temporary')
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
    audioRef.current?.pause()
    setReferenceStarting(false)
    setReferencePlaying(false)
  }, [clearSourceWatchdog])

  const stopEverything = useCallback((nextMessage?: string) => {
    stopChip()
    pauseReference()
    if (nextMessage) setMessage(nextMessage)
  }, [pauseReference, stopChip])

  const broadcastPlayback = useCallback(() => {
    const signal = createPlaybackSignal(tabIdRef.current, BUILD_ID)
    playbackChannelRef.current?.postMessage(signal)
    safeStorageSet(browserStorage(), PLAYBACK_SIGNAL_KEY, JSON.stringify(signal))
  }, [])

  const syncReference = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    setPlayhead(Math.floor(sourceRowPosition(audio.currentTime, project.sourceSync, project.tempo, project.rows)))
  }, [project.rows, project.sourceSync, project.tempo])

  const startChip = useCallback((nextMessage = 'Playing edited chip preview', purpose: ChipPurpose = 'preview') => {
    stopChip()
    pauseReference()
    broadcastPlayback()
    void engine.unlock()
    setChipPurpose(purpose)
    if (purpose === 'fallback') setPreviewMode('chip')
    const rowDuration = 60 / project.tempo / 4
    const sessionTicks = selectedTrack.kind === 'bonus' ? Math.ceil(selectedTrack.duration / rowDuration) : Number.POSITIVE_INFINITY
    let elapsedTicks = 0
    let row = playhead
    const tick = () => {
      if (elapsedTicks >= sessionTicks) {
        stopChip('Ten-minute bonus session finished')
        return
      }
      setPlayhead(row)
      channels.forEach((channel) => {
        if (!muted.has(channel.id)) engine.play(project.cells[channel.id][row], channel, rowDuration * 0.9)
      })
      row += 1
      elapsedTicks += 1
      if (row >= project.rows) {
        if (project.loop) row = 0
        else stopChip('Finished')
      }
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
        startChip('Source audio stalled — edited chip fallback active', 'fallback')
        return
      }
      setReferenceStarting(false)
      setReferencePlaying(true)
      setMessage('Playing original recording')
    }, SOURCE_STALL_GRACE_MS)
  }, [clearSourceWatchdog, startChip])

  const beginSourcePlayback = useCallback((looping = false) => {
    const audio = audioRef.current
    if (!audio) {
      startChip('Source audio unavailable — edited chip fallback active', 'fallback')
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
    const offset = sourceLoopStart(project.sourceSync)
    if (looping || audio.ended || (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration - 0.05) || audio.currentTime < offset) {
      audio.currentTime = offset
    }
    const initialTime = audio.currentTime
    try {
      void Promise.resolve(audio.play()).then(() => {
        if (sourceAttemptRef.current === attempt) armSourceWatchdog(attempt, initialTime)
      }).catch(() => {
        if (sourceAttemptRef.current === attempt) startChip('Source audio was blocked — edited chip fallback active', 'fallback')
      })
    } catch {
      if (sourceAttemptRef.current === attempt) startChip('Source audio was blocked — edited chip fallback active', 'fallback')
    }
  }, [armSourceWatchdog, broadcastPlayback, clearSourceWatchdog, project.sourceSync, startChip, stopChip])

  const selectTrack = (track: LibraryTrack) => {
    if (track.id === selectedId) return
    stopEverything()
    setSelectedId(track.id)
    setProject(loadProject(track))
    setUndoStack([])
    setRedoStack([])
    setPlayhead(0)
    setSelectedRow(0)
    setSelectedChannel('pulse1')
    setView('tracker')
    setMuted(new Set())
    setEditing(false)
    setPreviewMode(track.audio ? 'source' : 'chip')
    setSaveStatus(browserStorage() ? 'saving' : 'temporary')
    setLastSavedAt(null)
    window.history.replaceState(null, '', `#${track.slug}`)
    setMessage(`Loaded ${track.shortTitle}`)
  }

  useEffect(() => {
    const saved = safeStorageSet(browserStorage(), storageKey(selectedId), serializeProject(project))
    setStorageHealthy(saved)
    setSaveStatus(saved ? 'saved' : 'temporary')
    if (saved) setLastSavedAt(Date.now())
  }, [project, selectedId])

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
        editing: editingRef.current,
        storageHealthy: storageHealthyRef.current,
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

  const setNote = useCallback((channelId: ChannelId, row: number, note: string | null) => {
    if (!editing) return
    const previous = project.cells[channelId][row]
    commit((draft) => {
      draft.cells[channelId][row].note = note
      draft.cells[channelId][row].edited = true
    })
    setSelectedChannel(channelId)
    setSelectedRow(row)
    setMessage(note ? `${note} entered · autosaving in this browser` : 'Note cleared · autosaving in this browser')
    const channel = channels.find((candidate) => candidate.id === channelId)
    if (note && channel && !playbackActiveRef.current) {
      void engine.unlock().then((unlocked) => {
        if (!unlocked || playbackActiveRef.current) return
        engine.play({ ...previous, note, instrument: previous.instrument ?? 0, volume: previous.volume ?? 12, edited: true }, channel, 0.22)
      })
    }
  }, [commit, editing, project.cells])

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
        setNote(selectedChannel, selectedRow, null)
        return
      }
      if (event.key.toLowerCase() === 'z') { setOctave((value) => Math.max(1, value - 1)); return }
      if (event.key.toLowerCase() === 'x') { setOctave((value) => Math.min(7, value + 1)); return }
      const semitone = keys.indexOf(event.key.toLowerCase())
      if (semitone >= 0) {
        event.preventDefault()
        setNote(selectedChannel, selectedRow, midiToNote((octave + 1) * 12 + semitone))
        setSelectedRow((row) => Math.min(project.rows - 1, row + 1))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editing, octave, project.rows, selectedChannel, selectedRow, setNote, toggleTransport])

  const undo = () => {
    const previous = undoStack[undoStack.length - 1]
    if (!previous) return
    setRedoStack((stack) => [...stack, cloneProject(project)])
    setUndoStack((stack) => stack.slice(0, -1))
    setSaveStatus(storageHealthyRef.current ? 'saving' : 'temporary')
    setProject(previous)
    setMessage('Undid edit')
  }

  const redo = () => {
    const next = redoStack[redoStack.length - 1]
    if (!next) return
    setUndoStack((stack) => [...stack, cloneProject(project)])
    setRedoStack((stack) => stack.slice(0, -1))
    setSaveStatus(storageHealthyRef.current ? 'saving' : 'temporary')
    setProject(next)
    setMessage('Redid edit')
  }

  const onImport = async (file: File) => {
    try {
      const text = await file.text()
      const imported = file.name.toLowerCase().endsWith('.txt')
        ? importFamiTrackerText(text, selectedTrack.id)
        : parseProject(text)
      const shippedRevision = recoveredProjectForTrack(selectedTrack)?.contentRevision ?? 0
      setUndoStack((stack) => [...stack, cloneProject(project)])
      setProject({ ...imported, sourceId: selectedTrack.id, contentRevision: Math.max(imported.contentRevision, shippedRevision + 1) })
      setSaveStatus(storageHealthyRef.current ? 'saving' : 'temporary')
      setMessage(`Imported ${file.name}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed')
    }
  }

  const exportNative = () => {
    downloadText(filename(project.title, 'chipvault.json'), serializeProject(project), 'application/json')
    setMessage('Downloaded editable project')
  }

  const exportFami = () => {
    downloadText(filename(project.title, 'famitracker.txt'), exportFamiTrackerText(project), 'text/plain')
    setMessage('Downloaded FamiTracker text module')
  }

  const handleReferencePlaying = () => {
    clearSourceWatchdog()
    stopChip()
    setReferenceStarting(false)
    setReferencePlaying(true)
    broadcastPlayback()
    setMessage('Playing original recording')
  }

  const handleReferencePause = () => {
    sourceAttemptRef.current += 1
    clearSourceWatchdog()
    setReferenceStarting(false)
    setReferencePlaying(false)
  }

  const handleReferenceWaiting = () => {
    if (!referenceActive) return
    const audio = audioRef.current
    if (!audio) return
    setMessage('Buffering original recording…')
    armSourceWatchdog(sourceAttemptRef.current, audio.currentTime)
  }

  const handleReferenceEnded = () => {
    clearSourceWatchdog()
    setReferenceStarting(false)
    setReferencePlaying(false)
    if (shouldRestartSource(project.loop, document.hidden) && (!editing || previewMode === 'source')) {
      beginSourcePlayback(true)
    } else {
      sourceAttemptRef.current += 1
      setMessage('Recording finished')
    }
  }

  const handleReferenceError = () => {
    if (referenceActive) startChip('Source audio failed — edited chip fallback active', 'fallback')
    else setMessage('Source recording could not load in this browser')
  }

  function toggleTransport() {
    if (playbackActive) {
      stopEverything('Paused')
      return
    }
    if ((!editing || previewMode === 'source') && audioRef.current) beginSourcePlayback()
    else startChip(selectedTrack.kind === 'bonus' ? 'Playing editable chiptune arrangement' : 'Playing edited chip preview')
  }

  const setEditMode = (next: boolean) => {
    if (next === editing) return
    stopEverything()
    setEditing(next)
    if (next) {
      const mode: PreviewMode = selectedTrack.audio ? 'source' : 'chip'
      setPreviewMode(mode)
      setMessage(mode === 'source' ? 'Editing · original recording selected · changes autosave here' : 'Editing browser chiptune · changes autosave here')
    } else {
      setPreviewMode(selectedTrack.audio ? 'source' : 'chip')
      setMessage('Viewing recovered source')
    }
  }

  const choosePreview = (next: PreviewMode) => {
    if (next === 'source' && !selectedTrack.audio) return
    stopEverything()
    setPreviewMode(next)
    setMessage(next === 'source'
      ? 'Original recording selected · authentic mix, edits remain visible'
      : 'Edited chip preview selected · approximate synthesized mix')
  }

  const setEditorView = (next: ViewMode) => {
    if (next === view) return
    stopEverything()
    setView(next)
    setMessage(next === 'tracker' ? 'Tracker grid ready' : 'Piano roll ready')
  }

  const returnToStart = () => {
    stopEverything()
    if (audioRef.current) audioRef.current.currentTime = project.sourceSync?.audioOffset ?? 0
    setPlayhead(0)
    setMessage('Returned to first row')
  }

  const reset = () => {
    if (!window.confirm(`Reset local edits for “${selectedTrack.shortTitle}”?`)) return
    setUndoStack((stack) => [...stack, cloneProject(project)])
    setSaveStatus(storageHealthyRef.current ? 'saving' : 'temporary')
    setProject(recoveredProjectForTrack(selectedTrack) ?? createDraft(selectedTrack))
    setMessage('Restored the clean recovery baseline')
  }

  const reloadCurrentBuild = () => {
    const url = new URL(window.location.href)
    url.searchParams.set('build', Date.now().toString())
    window.location.replace(url)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="N9NES9 Chipvault home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span><b>N9NES9</b><em>CHIPVAULT</em></span>
        </a>
        <div className="topbar-status"><span className="live-dot" /> Online tracker · 18 editable patterns</div>
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
            <div className="workspace-mode" aria-label="Workspace mode">
              <button className={!editing ? 'active' : ''} onClick={() => setEditMode(false)}><span>View</span><small>source animation</small></button>
              <button className={editing ? 'active' : ''} onClick={() => setEditMode(true)}><span>Edit</span><small>browser workspace</small></button>
              <details className="export-menu mode-export"><summary>Export</summary><div><button onClick={exportNative}>Chipvault JSON</button><button onClick={exportFami}>FamiTracker TXT</button>{selectedTrack.audio && <a href={asset(selectedTrack.audio)} download={`${selectedTrack.slug}.m4a`}>Source audio M4A</a>}<button onClick={() => importRef.current?.click()}>Import project</button>{editing && <button className="danger-action" onClick={reset}>Reset edits</button>}</div></details>
            </div>
            {selectedTrack.audio && <div className="source-player">
              <audio ref={audioRef} key={selectedTrack.id} src={asset(selectedTrack.audio)} controls preload="auto" playsInline onPlaying={handleReferencePlaying} onPause={handleReferencePause} onWaiting={handleReferenceWaiting} onStalled={handleReferenceWaiting} onEnded={handleReferenceEnded} onError={handleReferenceError} onTimeUpdate={syncReference} />
              <a className="youtube-link" href={selectedTrack.sourceUrl} target="_blank" rel="noreferrer">Original upload ↗</a>
            </div>}
            {selectedTrack.kind === 'bonus' && <div className="bonus-source"><span>Browser chiptune arrangement</span><a href={selectedTrack.sourceUrl} target="_blank" rel="noreferrer">Reference performance ↗</a></div>}
          </div>
        </section>

        {!storageHealthy && <section className="storage-warning" role="status"><strong>Temporary browser session</strong><span>This browser blocked local storage. The editor still works, but export Chipvault JSON before closing the tab if you want to keep changes.</span></section>}

        <section className={`recovery-banner ${project.recoveryStatus}`}>
          <span className="warning-icon" aria-hidden="true">!</span>
          {project.recoveryStatus === 'pattern-recovered' ? (
            <div><strong>Animated pattern recovered from the video · {Math.round((project.sourceSync?.confidence ?? 0) * 100)}% transcription confidence</strong><p>{project.rows / project.patternLength} visible FamiTracker orders are synchronised to the original recording. Hidden instrument envelopes remain reconstructed, not original.</p></div>
          ) : project.recoveryStatus === 'audio-transcribed' ? (
            <div><strong>Audio-derived editable pattern · {Math.round((project.sourceSync?.confidence ?? 0) * 100)}% pitch confidence</strong><p>Dominant notes, bass, harmony, and rhythm were extracted from the preserved mix. It is populated and playable, but it is not claimed to be the lost original channel data.</p></div>
          ) : project.recoveryStatus === 'arranged-cover' ? (
            <div><strong>Editable VRC6-style chiptune arrangement · ten-minute session</strong><p>The recognizable sax riff, harmony, bass, and drums are synthesized by the browser tracker and loop as editable pattern data.</p></div>
          ) : (
            <div><strong>Recovery draft — original module not yet found</strong><p>The recording is authentic. Pattern data starts blank until transcribed or an original FTM is imported. Edits are autosaved only in this browser.</p></div>
          )}
          <button onClick={() => setAboutOpen(true)}>Why?</button>
        </section>

        <section className="workbench" data-transport={transportMode}>
          <div className="transport-bar">
            <div className="transport-buttons">
              <button className="play-button" onClick={toggleTransport} aria-label={playbackActive ? `Pause ${playbackName}` : `Play ${playbackName}`} title={playbackActive ? `Pause ${playbackName}` : `Play ${playbackName}`}>{playbackActive ? '■' : '▶'}</button>
              <button onClick={returnToStart} aria-label="Return to first row">↤</button>
            </div>
            <label>BPM<input type="number" min="32" max="300" disabled={!editing} value={project.tempo} onChange={(event) => commit((draft) => { draft.tempo = Number(event.target.value) })} /></label>
            <label>Speed<input type="number" min="1" max="31" disabled={!editing} value={project.speed} onChange={(event) => commit((draft) => { draft.speed = Number(event.target.value) })} /></label>
            <label className="loop-control"><input type="checkbox" disabled={!editing} checked={project.loop} onChange={(event) => commit((draft) => { draft.loop = event.target.checked })} /> Loop</label>
            <div className="transport-spacer" />
            <button onClick={undo} disabled={!undoStack.length} title="Undo">↶</button>
            <button onClick={redo} disabled={!redoStack.length} title="Redo">↷</button>
            <span className={`save-state ${editedCount ? 'has-edits' : ''} ${saveStatus}`} role="status" aria-live="polite" title="Projects are stored only in this browser on this device. Export JSON for a portable backup."><i /> {editing ? saveText : 'source view'}</span>
          </div>

          {editing && <div className="edit-session-bar">
            <div className="preview-switch" role="group" aria-label="Playback preview">
              <button className={previewMode === 'source' ? 'active' : ''} disabled={!selectedTrack.audio} onClick={() => choosePreview('source')}><span>Original mix</span><small>{selectedTrack.audio ? 'authentic recording' : 'unavailable'}</small></button>
              <button className={previewMode === 'chip' ? 'active' : ''} onClick={() => choosePreview('chip')}><span>Edited preview</span><small>browser chiptune</small></button>
            </div>
            <p>{previewMode === 'source'
              ? <><strong>Authentic sound</strong><span>Your edits stay visible and each entered note is auditioned. Switch to Edited preview to hear the whole editable draft.</span></>
              : <><strong>Approximate edited sound</strong><span>This synthesizes the reconstructed notes, so it will not match the original recording exactly.</span></>}</p>
            <div className={`edit-save-card ${saveStatus}`} role="status" aria-live="polite"><i /><span><strong>{saveStatus === 'temporary' ? 'Not saved' : saveStatus === 'saving' ? 'Saving…' : 'Saved locally'}</strong><small>{saveStatus === 'temporary' ? 'Export JSON before closing' : savedTime ? `This browser · ${savedTime} · ${editedCount} edit${editedCount === 1 ? '' : 's'}` : 'Autosave is ready'}</small></span></div>
          </div>}

          <div className="editor-tabs">
            <div role="tablist" aria-label="Editor view">
              <button role="tab" aria-selected={view === 'tracker'} className={view === 'tracker' ? 'active' : ''} onClick={() => setEditorView('tracker')}>Tracker</button>
              <button role="tab" aria-selected={view === 'piano'} className={view === 'piano' ? 'active' : ''} onClick={() => setEditorView('piano')}>Piano roll</button>
            </div>
            <div className="octave-control"><button onClick={() => setOctave(Math.max(1, octave - 1))}>−</button><span>Oct {octave}</span><button onClick={() => setOctave(Math.min(7, octave + 1))}>+</button></div>
          </div>

          {view === 'tracker' ? (
            <TrackerGrid project={project} playhead={playhead} referenceAudioRef={audioRef} referenceActive={referenceActive} chipPlaying={playing} selectedChannel={selectedChannel} selectedRow={selectedRow} muted={muted} editing={editing} onMute={(id) => setMuted((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })} onSelect={(id, row) => { setSelectedChannel(id); setSelectedRow(row) }} onClear={(id, row) => setNote(id, row, null)} />
          ) : (
            <PianoRoll project={project} channelId={selectedChannel} selectedRow={selectedRow} editing={editing} onChannel={setSelectedChannel} onSetNote={setNote} />
          )}

          <div className={`entry-strip ${editing ? '' : 'viewing'}`}>
            <div><span className="eyebrow">Selected cell</span><strong>{channels.find((channel) => channel.id === selectedChannel)?.name} · row {selectedRow.toString(16).padStart(2, '0').toUpperCase()}</strong></div>
            {editing ? <><div className="note-keys" aria-label="Quick note entry">
              {Array.from({ length: 12 }, (_, index) => midiToNote((octave + 1) * 12 + index)).map((note) => (
                <button key={note} className={note.includes('#') ? 'sharp' : ''} onClick={() => setNote(selectedChannel, selectedRow, note)}>{note}</button>
              ))}
              <button className="clear-note" onClick={() => setNote(selectedChannel, selectedRow, null)}>clear</button>
            </div>
            <div className="cell-inspector">
              <label>Volume <input type="range" min="0" max="15" value={selectedCell.volume ?? 15} onChange={(event) => commit((draft) => { const cell = draft.cells[selectedChannel][selectedRow]; cell.volume = Number(event.target.value); cell.edited = true })} /><output>{(selectedCell.volume ?? 15).toString(16).toUpperCase()}</output></label>
              <label>Effect <input aria-label="Effect command" value={selectedCell.effect} maxLength={3} placeholder="0xy" onChange={(event) => { const value = event.target.value.toUpperCase().replace(/[^0-9A-FP-Z]/g, '').slice(0, 3); commit((draft) => { const cell = draft.cells[selectedChannel][selectedRow]; cell.effect = value; cell.edited = true }) }} /></label>
            </div>
            <p><kbd>A–K</kbd> enter notes · <kbd>Z/X</kbd> octave · <kbd>Del</kbd> clear · <kbd>Space</kbd> play</p></> : <div className="view-mode-copy"><strong>Fixed playhead · moving pattern</strong><span>Press Play to follow the recovered grid in time with the original recording.</span></div>}
          </div>
        </section>
        <input ref={importRef} type="file" accept=".json,.txt" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file); event.target.value = '' }} />
        <footer><span>{message}</span><span>Build {BUILD_ID} · no analytics · data stays local</span></footer>
      </main>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  )
}

function TrackerGrid({ project, playhead, referenceAudioRef, referenceActive, chipPlaying, selectedChannel, selectedRow, muted, editing, onMute, onSelect, onClear }: {
  project: TrackerProject
  playhead: number
  referenceAudioRef: React.RefObject<HTMLAudioElement | null>
  referenceActive: boolean
  chipPlaying: boolean
  selectedChannel: ChannelId
  selectedRow: number
  muted: Set<ChannelId>
  editing: boolean
  onMute: (id: ChannelId) => void
  onSelect: (id: ChannelId, row: number) => void
  onClear: (id: ChannelId, row: number) => void
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
              const instrument = cell.note && cell.instrument !== null ? cell.instrument.toString(16).padStart(2, '0').toUpperCase() : '··'
              const volume = cell.note && cell.volume !== null ? cell.volume.toString(16).toUpperCase() : '·'
              const effect = cell.effect || '···'
              return <td key={channel.id} style={{ '--channel': channel.color } as React.CSSProperties}><button aria-label={`${channel.name}, row ${row}${cell.edited ? ', user edited' : ''}`} className={`${selected ? 'selected-cell' : ''} ${cell.edited ? 'user-edited' : ''}`} onClick={() => onSelect(channel.id, row)} onDoubleClick={() => { if (editing) onClear(channel.id, row) }} onContextMenu={(event) => { if (editing) { event.preventDefault(); onClear(channel.id, row) } }}>
                <b className={`note-token ${cell.note ? '' : 'empty-token'}`}>{cell.note ?? '···'}</b>
                <span className="cell-fields"><i className={`instrument-token ${instrument === '··' ? 'empty-token' : ''}`}>{instrument}</i><i className={`volume-token ${volume === '·' ? 'empty-token' : ''}`}>{volume}</i><i className={`effect-token ${effect === '···' ? 'empty-token' : ''}`}>{effect}</i></span>
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
      <div className="piano-toolbar"><label>Editing<select value={channelId} onChange={(event) => onChannel(event.target.value as ChannelId)}>{channels.map((channel) => <option value={channel.id} key={channel.id}>{channel.name}</option>)}</select></label><span>Click to draw · click again to erase</span></div>
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
        <div className="dialog-facts"><div><strong>18</strong><span>editable patterns</span></div><div><strong>8</strong><span>NES + VRC6 channels</span></div><div><strong>0</strong><span>blank track baselines</span></div></div>
        <button className="primary-action dialog-action" onClick={onClose}>Back to the editor</button>
      </section>
    </div>
  )
}

export default App
