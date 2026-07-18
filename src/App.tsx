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
import { BUILD_ID, fetchBuildManifest, shouldReloadBuild } from './lib/versioning'
import type { ChannelId, LibraryTrack, TrackerProject } from './types'

type ViewMode = 'tracker' | 'piano'
type Filter = 'all' | 'original' | 'cover' | 'demo' | 'bonus'

const engine = new ChipAudioEngine()
const storageKey = (id: string) => `n9nes9-chipvault:${id}`
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`

function loadProject(track: LibraryTrack): TrackerProject {
  const recovered = recoveredProjectForTrack(track)
  const stored = localStorage.getItem(storageKey(track.id))
  if (!stored) return recovered ?? createDraft(track)
  try {
    const saved = parseProject(stored)
    return recovered && saved.contentRevision < recovered.contentRevision ? recovered : saved
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
  const [referencePlaying, setReferencePlaying] = useState(false)
  const [editing, setEditing] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [muted, setMuted] = useState<Set<ChannelId>>(new Set())
  const [message, setMessage] = useState('Ready')
  const [aboutOpen, setAboutOpen] = useState(false)
  const [updateReady, setUpdateReady] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const timerRef = useRef<number | null>(null)

  const filtered = useMemo(() => library.filter((track) => {
    const matchesFilter = filter === 'all' || track.kind === filter
    const haystack = `${track.shortTitle} ${track.description} ${track.credit ?? ''}`.toLowerCase()
    return matchesFilter && haystack.includes(query.trim().toLowerCase())
  }), [filter, query])
  const selectedCell = project.cells[selectedChannel][selectedRow]
  const editedCount = useMemo(() => channels.reduce((total, channel) => (
    total + project.cells[channel.id].filter((cell) => cell.edited).length
  ), 0), [project])

  const commit = useCallback((mutate: (draft: TrackerProject) => void) => {
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
    if (nextMessage) setMessage(nextMessage)
  }, [])

  const pauseReference = useCallback(() => {
    audioRef.current?.pause()
    setReferencePlaying(false)
  }, [])

  const stopEverything = useCallback((nextMessage?: string) => {
    stopChip()
    pauseReference()
    if (nextMessage) setMessage(nextMessage)
  }, [pauseReference, stopChip])

  const syncReference = useCallback(() => {
    const audio = audioRef.current
    const sync = project.sourceSync
    if (!audio || !sync) return
    const elapsed = Math.max(0, audio.currentTime - sync.audioOffset)
    setPlayhead(Math.floor(elapsed / sync.secondsPerRow) % sync.loopRows)
  }, [project.sourceSync])

  const start = useCallback(() => {
    if (playing) { stopChip('Stopped'); return }
    pauseReference()
    const rowDuration = 60 / project.tempo / 4
    let row = playhead
    const tick = () => {
      setPlayhead(row)
      channels.forEach((channel) => {
        if (!muted.has(channel.id)) engine.play(project.cells[channel.id][row], channel, rowDuration * 0.9)
      })
      row += 1
      if (row >= project.rows) {
        if (project.loop) row = 0
        else stopChip('Finished')
      }
    }
    tick()
    timerRef.current = window.setInterval(tick, rowDuration * 1000)
    setPlaying(true)
    setMessage('Playing chip preview')
  }, [muted, pauseReference, playhead, playing, project, stopChip])

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
    window.history.replaceState(null, '', `#${track.slug}`)
    setMessage(`Loaded ${track.shortTitle}`)
  }

  useEffect(() => {
    localStorage.setItem(storageKey(selectedId), serializeProject(project))
  }, [project, selectedId])

  useEffect(() => () => stopEverything(), [stopEverything])

  useEffect(() => {
    let disposed = false
    const checkForUpdate = async () => {
      const manifest = await fetchBuildManifest(import.meta.env.BASE_URL)
      if (!disposed && shouldReloadBuild(manifest?.build)) setUpdateReady(true)
    }
    const reconcileReferenceState = () => {
      const audio = audioRef.current
      const active = Boolean(audio && !audio.paused && !audio.ended)
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
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pageshow', onPageShow)
    const updateInterval = window.setInterval(() => { if (!document.hidden) void checkForUpdate() }, 300_000)
    const mediaInterval = window.setInterval(() => { if (!document.hidden) reconcileReferenceState() }, 1_000)
    void checkForUpdate()
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pageshow', onPageShow)
      window.clearInterval(updateInterval)
      window.clearInterval(mediaInterval)
    }
  }, [stopEverything, syncReference])

  const setNote = useCallback((channelId: ChannelId, row: number, note: string | null) => {
    if (!editing) return
    commit((draft) => {
      draft.cells[channelId][row].note = note
      draft.cells[channelId][row].edited = true
    })
    setSelectedChannel(channelId)
    setSelectedRow(row)
  }, [commit, editing])

  useEffect(() => {
    const keys = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k']
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches('input, select, textarea, button, audio')) return
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
    const previous = undoStack.at(-1)
    if (!previous) return
    setRedoStack((stack) => [...stack, cloneProject(project)])
    setUndoStack((stack) => stack.slice(0, -1))
    setProject(previous)
    setMessage('Undid edit')
  }

  const redo = () => {
    const next = redoStack.at(-1)
    if (!next) return
    setUndoStack((stack) => [...stack, cloneProject(project)])
    setRedoStack((stack) => stack.slice(0, -1))
    setProject(next)
    setMessage('Redid edit')
  }

  const onImport = async (file: File) => {
    try {
      const text = await file.text()
      const imported = file.name.toLowerCase().endsWith('.txt')
        ? importFamiTrackerText(text, selectedTrack.id)
        : parseProject(text)
      setUndoStack((stack) => [...stack, cloneProject(project)])
      setProject({ ...imported, sourceId: selectedTrack.id })
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

  function toggleTransport() {
    if (selectedTrack.externalVideoId) {
      setMessage('Use the official YouTube controls for the bonus session')
      return
    }
    if (!editing && audioRef.current) {
      if (audioRef.current.paused) {
        if (project.sourceSync && audioRef.current.currentTime < project.sourceSync.audioOffset) audioRef.current.currentTime = project.sourceSync.audioOffset
        void audioRef.current.play()
      } else {
        audioRef.current.pause()
      }
      return
    }
    start()
  }

  const setEditMode = (next: boolean) => {
    if (next === editing || selectedTrack.externalVideoId) return
    stopEverything()
    setEditing(next)
    setMessage(next ? 'Editing a browser working copy' : 'Viewing recovered source')
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

  const saveWorkspace = () => {
    localStorage.setItem(storageKey(selectedId), serializeProject(project))
    setMessage('Saved in this browser')
  }

  const reset = () => {
    if (!window.confirm(`Reset local edits for “${selectedTrack.shortTitle}”?`)) return
    setUndoStack((stack) => [...stack, cloneProject(project)])
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
        <div className="topbar-status"><span className="live-dot" /> Online tracker · 17 recordings + bonus</div>
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
            {!selectedTrack.externalVideoId && <div className="workspace-mode" aria-label="Workspace mode">
              <button className={!editing ? 'active' : ''} onClick={() => setEditMode(false)}><span>View</span><small>source animation</small></button>
              <button className={editing ? 'active' : ''} onClick={() => setEditMode(true)}><span>Edit</span><small>browser workspace</small></button>
              <details className="export-menu mode-export"><summary>Export</summary><div><button onClick={exportNative}>Chipvault JSON</button><button onClick={exportFami}>FamiTracker TXT</button>{selectedTrack.audio && <a href={asset(selectedTrack.audio)} download={`${selectedTrack.slug}.m4a`}>Source audio M4A</a>}<button onClick={() => importRef.current?.click()}>Import project</button>{editing && <button className="danger-action" onClick={reset}>Reset edits</button>}</div></details>
            </div>}
            {selectedTrack.audio && <div className="source-player">
              <audio ref={audioRef} key={selectedTrack.id} src={asset(selectedTrack.audio)} controls preload="metadata" onPlay={() => { stopChip(); setReferencePlaying(true); setMessage('Playing original recording') }} onPause={() => setReferencePlaying(false)} onEnded={() => { setReferencePlaying(false); setMessage('Recording finished') }} onTimeUpdate={syncReference} />
              <a className="youtube-link" href={selectedTrack.sourceUrl} target="_blank" rel="noreferrer">Original upload ↗</a>
            </div>}
            {selectedTrack.externalVideoId && <div className="bonus-source"><span>Official external stream</span><a href={selectedTrack.sourceUrl} target="_blank" rel="noreferrer">Open on YouTube ↗</a></div>}
          </div>
        </section>

        {selectedTrack.externalVideoId ? (
          <BonusPlayer track={selectedTrack} />
        ) : <>
        <section className={`recovery-banner ${project.recoveryStatus === 'pattern-recovered' ? 'recovered' : ''}`}>
          <span className="warning-icon" aria-hidden="true">!</span>
          {project.recoveryStatus === 'pattern-recovered' ? (
            <div><strong>Animated pattern recovered from the video · {Math.round((project.sourceSync?.confidence ?? 0) * 100)}% transcription confidence</strong><p>{project.rows / project.patternLength} visible FamiTracker orders are synchronised to the original recording. Hidden instrument envelopes remain reconstructed, not original.</p></div>
          ) : (
            <div><strong>Recovery draft — original module not yet found</strong><p>The recording is authentic. Pattern data starts blank until transcribed or an original FTM is imported. Edits are autosaved only in this browser.</p></div>
          )}
          <button onClick={() => setAboutOpen(true)}>Why?</button>
        </section>

        <section className="workbench">
          <div className="transport-bar">
            <div className="transport-buttons">
              <button className="play-button" onClick={toggleTransport} aria-label={(playing || referencePlaying) ? 'Pause playback' : 'Play tracker'}>{(playing || referencePlaying) ? '■' : '▶'}</button>
              <button onClick={returnToStart} aria-label="Return to first row">↤</button>
            </div>
            <label>BPM<input type="number" min="32" max="300" disabled={!editing} value={project.tempo} onChange={(event) => commit((draft) => { draft.tempo = Number(event.target.value) })} /></label>
            <label>Speed<input type="number" min="1" max="31" disabled={!editing} value={project.speed} onChange={(event) => commit((draft) => { draft.speed = Number(event.target.value) })} /></label>
            <label className="loop-control"><input type="checkbox" disabled={!editing} checked={project.loop} onChange={(event) => commit((draft) => { draft.loop = event.target.checked })} /> Loop</label>
            <div className="transport-spacer" />
            <button onClick={undo} disabled={!undoStack.length} title="Undo">↶</button>
            <button onClick={redo} disabled={!redoStack.length} title="Redo">↷</button>
            {editing && <button className="save-button" onClick={saveWorkspace}>Save</button>}
            <span className={`save-state ${editedCount ? 'has-edits' : ''}`}><i /> {editing ? `${editedCount} user-edited cell${editedCount === 1 ? '' : 's'}` : 'source view'}</span>
          </div>

          <div className="editor-tabs">
            <div role="tablist" aria-label="Editor view">
              <button role="tab" aria-selected={view === 'tracker'} className={view === 'tracker' ? 'active' : ''} onClick={() => setEditorView('tracker')}>Tracker</button>
              <button role="tab" aria-selected={view === 'piano'} className={view === 'piano' ? 'active' : ''} onClick={() => setEditorView('piano')}>Piano roll</button>
            </div>
            <div className="octave-control"><button onClick={() => setOctave(Math.max(1, octave - 1))}>−</button><span>Oct {octave}</span><button onClick={() => setOctave(Math.min(7, octave + 1))}>+</button></div>
          </div>

          {view === 'tracker' ? (
            <TrackerGrid project={project} playhead={playhead} referenceAudioRef={audioRef} referencePlaying={referencePlaying} chipPlaying={playing} selectedChannel={selectedChannel} selectedRow={selectedRow} muted={muted} editing={editing} onMute={(id) => setMuted((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })} onSelect={(id, row) => { setSelectedChannel(id); setSelectedRow(row) }} onClear={(id, row) => setNote(id, row, null)} />
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
        </section></>}
        <input ref={importRef} type="file" accept=".json,.txt" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file); event.target.value = '' }} />
        <footer><span>{message}</span><span>Build {BUILD_ID} · no analytics · data stays local</span></footer>
      </main>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  )
}

function TrackerGrid({ project, playhead, referenceAudioRef, referencePlaying, chipPlaying, selectedChannel, selectedRow, muted, editing, onMute, onSelect, onClear }: {
  project: TrackerProject
  playhead: number
  referenceAudioRef: React.RefObject<HTMLAudioElement | null>
  referencePlaying: boolean
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
    if (!referencePlaying || reduceMotion) updatePosition(playhead, chipPlaying)
  }, [chipPlaying, playhead, referencePlaying, updatePosition])

  useEffect(() => {
    const sync = project.sourceSync
    if (!referencePlaying || !sync) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const animate = () => {
      const audio = referenceAudioRef.current
      if (!audio) return
      const elapsed = Math.max(0, audio.currentTime - sync.audioOffset)
      updatePosition((elapsed / sync.secondsPerRow) % sync.loopRows)
      frame = window.requestAnimationFrame(animate)
    }
    frame = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frame)
  }, [project.sourceSync, referenceAudioRef, referencePlaying, updatePosition])

  return (
    <div className={`tracker-scroll ${referencePlaying || chipPlaying ? 'is-playing' : ''}`} ref={scrollRef}>
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
  const editedRows = new Set(project.cells[channelId].flatMap((cell, row) => cell.edited ? [row] : []))
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

function BonusPlayer({ track }: { track: LibraryTrack }) {
  const videoId = track.externalVideoId as string
  const end = track.externalEnd ?? 600
  const embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}?end=${end}&rel=0&playsinline=1`
  return (
    <section className="bonus-player" aria-labelledby="bonus-player-title">
      <div className="bonus-copy">
        <p className="eyebrow">Bonus transmission / 10:00</p>
        <h3 id="bonus-player-title">Ten minutes of maximum sax.</h3>
        <p>This uses the official Eurovision player and stops at the ten-minute mark. It is an external bonus stream, so it is deliberately not included in Chipvault downloads or FamiTracker exports.</p>
        <div className="bonus-meter" aria-hidden="true">{Array.from({ length: 24 }, (_, index) => <i key={index} style={{ '--delay': `${index * -0.07}s` } as React.CSSProperties} />)}</div>
      </div>
      <div className="bonus-frame"><iframe src={embedUrl} title="Official Epic Sax Guy ten-minute bonus session" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></div>
    </section>
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
        <p>Hidden instrument macros still have to be reconstructed and every result is confidence-labelled. Game Complete Loop is the first synchronized recovery; the remaining recordings stay honest blank drafts until their video frames are decoded.</p>
        <div className="dialog-facts"><div><strong>17</strong><span>music recordings</span></div><div><strong>8</strong><span>NES + VRC6 channels</span></div><div><strong>1</strong><span>synchronized recovery</span></div></div>
        <button className="primary-action dialog-action" onClick={onClose}>Back to the editor</button>
      </section>
    </div>
  )
}

export default App
