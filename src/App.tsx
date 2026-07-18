import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { channels, library } from './data/library'
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
import type { ChannelId, LibraryTrack, TrackerProject } from './types'

type ViewMode = 'tracker' | 'piano'
type Filter = 'all' | 'original' | 'cover' | 'demo'

const engine = new ChipAudioEngine()
const storageKey = (id: string) => `n9nes9-chipvault:${id}`
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`

function loadProject(track: LibraryTrack): TrackerProject {
  const stored = localStorage.getItem(storageKey(track.id))
  if (!stored) return createDraft(track)
  try { return parseProject(stored) } catch { return createDraft(track) }
}

function filename(title: string, extension: string): string {
  return `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.${extension}`
}

function App() {
  const initialTrack = library.find((track) => `#${track.slug}` === window.location.hash) ?? library[0]
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
  const [playhead, setPlayhead] = useState(0)
  const [muted, setMuted] = useState<Set<ChannelId>>(new Set())
  const [message, setMessage] = useState('Ready')
  const [aboutOpen, setAboutOpen] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const timerRef = useRef<number | null>(null)

  const filtered = useMemo(() => library.filter((track) => {
    const matchesFilter = filter === 'all' || track.kind === filter
    const haystack = `${track.shortTitle} ${track.description} ${track.credit ?? ''}`.toLowerCase()
    return matchesFilter && haystack.includes(query.trim().toLowerCase())
  }), [filter, query])
  const selectedCell = project.cells[selectedChannel][selectedRow]

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

  const stop = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
    engine.stop()
    setPlaying(false)
    setMessage('Stopped')
  }, [])

  const start = useCallback(() => {
    if (playing) { stop(); return }
    audioRef.current?.pause()
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
        else stop()
      }
    }
    tick()
    timerRef.current = window.setInterval(tick, rowDuration * 1000)
    setPlaying(true)
    setMessage('Playing chip preview')
  }, [muted, playhead, playing, project, stop])

  const selectTrack = (track: LibraryTrack) => {
    stop()
    setSelectedId(track.id)
    setProject(loadProject(track))
    setUndoStack([])
    setRedoStack([])
    setPlayhead(0)
    setSelectedRow(0)
    window.history.replaceState(null, '', `#${track.slug}`)
    setMessage(`Loaded ${track.shortTitle}`)
  }

  useEffect(() => {
    localStorage.setItem(storageKey(selectedId), serializeProject(project))
  }, [project, selectedId])

  useEffect(() => () => stop(), [stop])

  const setNote = useCallback((channelId: ChannelId, row: number, note: string | null) => {
    commit((draft) => { draft.cells[channelId][row].note = note })
    setSelectedChannel(channelId)
    setSelectedRow(row)
  }, [commit])

  useEffect(() => {
    const keys = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k']
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches('input, select, textarea, button, audio')) return
      if (event.code === 'Space') { event.preventDefault(); start(); return }
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
  }, [octave, project.rows, selectedChannel, selectedRow, setNote, start])

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

  const reset = () => {
    if (!window.confirm(`Clear the local recovery draft for “${selectedTrack.shortTitle}”?`)) return
    setUndoStack((stack) => [...stack, cloneProject(project)])
    setProject(createDraft(selectedTrack))
    setMessage('Started a fresh recovery draft')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="N9NES9 Chipvault home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span><b>N9NES9</b><em>CHIPVAULT</em></span>
        </a>
        <div className="topbar-status"><span className="live-dot" /> 17 recordings preserved</div>
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
          {(['all', 'original', 'cover', 'demo'] as Filter[]).map((item) => (
            <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>
          ))}
        </div>
        <div className="track-list">
          {filtered.map((track, index) => (
            <button key={track.id} className={`track-item ${selectedId === track.id ? 'selected' : ''}`} onClick={() => selectTrack(track)}>
              <span className="track-index">{String(index + 1).padStart(2, '0')}</span>
              <span className="track-copy"><b>{track.shortTitle}</b><small>{track.kind} · {Math.floor(track.duration / 60)}:{String(track.duration % 60).padStart(2, '0')}</small></span>
              <span className="track-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="studio" id="top">
        <section className="hero-card">
          <img src={asset(selectedTrack.poster)} alt="" />
          <div className="hero-copy">
            <div className="badge-row"><span className={`kind-badge ${selectedTrack.kind}`}>{selectedTrack.kind}</span><span>{selectedTrack.expansion}</span><span>{selectedTrack.uploaded.slice(0, 4)}</span></div>
            <h2>{selectedTrack.shortTitle}</h2>
            <p>{selectedTrack.description}</p>
            {selectedTrack.credit && <p className="credit">{selectedTrack.credit}</p>}
            <div className="source-player">
              <audio ref={audioRef} key={selectedTrack.id} src={asset(selectedTrack.audio)} controls preload="metadata" onPlay={stop} />
              <a className="download-link" href={asset(selectedTrack.audio)} download={`${selectedTrack.slug}.m4a`}>Download source audio ↓</a>
              <a className="youtube-link" href={selectedTrack.sourceUrl} target="_blank" rel="noreferrer">Original upload ↗</a>
            </div>
          </div>
        </section>

        <section className="recovery-banner">
          <span className="warning-icon" aria-hidden="true">!</span>
          <div><strong>Recovery draft — original module not yet found</strong><p>The recording is authentic. Pattern data starts blank until transcribed or an original FTM is imported. Edits are autosaved only in this browser.</p></div>
          <button onClick={() => setAboutOpen(true)}>Why?</button>
        </section>

        <section className="workbench">
          <div className="transport-bar">
            <div className="transport-buttons">
              <button className="play-button" onClick={start} aria-label={playing ? 'Stop chip preview' : 'Play chip preview'}>{playing ? '■' : '▶'}</button>
              <button onClick={() => setPlayhead(0)} aria-label="Return to first row">↤</button>
            </div>
            <label>BPM<input type="number" min="32" max="300" value={project.tempo} onChange={(event) => commit((draft) => { draft.tempo = Number(event.target.value) })} /></label>
            <label>Speed<input type="number" min="1" max="31" value={project.speed} onChange={(event) => commit((draft) => { draft.speed = Number(event.target.value) })} /></label>
            <label className="loop-control"><input type="checkbox" checked={project.loop} onChange={(event) => commit((draft) => { draft.loop = event.target.checked })} /> Loop</label>
            <div className="transport-spacer" />
            <button onClick={undo} disabled={!undoStack.length} title="Undo">↶</button>
            <button onClick={redo} disabled={!redoStack.length} title="Redo">↷</button>
            <span className="save-state"><i /> autosaved</span>
          </div>

          <div className="editor-tabs">
            <div role="tablist" aria-label="Editor view">
              <button role="tab" aria-selected={view === 'tracker'} className={view === 'tracker' ? 'active' : ''} onClick={() => setView('tracker')}>Tracker</button>
              <button role="tab" aria-selected={view === 'piano'} className={view === 'piano' ? 'active' : ''} onClick={() => setView('piano')}>Piano roll</button>
            </div>
            <div className="octave-control"><button onClick={() => setOctave(Math.max(1, octave - 1))}>−</button><span>Oct {octave}</span><button onClick={() => setOctave(Math.min(7, octave + 1))}>+</button></div>
          </div>

          {view === 'tracker' ? (
            <TrackerGrid project={project} playhead={playhead} selectedChannel={selectedChannel} selectedRow={selectedRow} muted={muted} onMute={(id) => setMuted((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })} onSelect={(id, row) => { setSelectedChannel(id); setSelectedRow(row) }} onClear={(id, row) => setNote(id, row, null)} />
          ) : (
            <PianoRoll project={project} channelId={selectedChannel} selectedRow={selectedRow} onChannel={setSelectedChannel} onSetNote={setNote} />
          )}

          <div className="entry-strip">
            <div><span className="eyebrow">Selected cell</span><strong>{channels.find((channel) => channel.id === selectedChannel)?.name} · row {selectedRow.toString(16).padStart(2, '0').toUpperCase()}</strong></div>
            <div className="note-keys" aria-label="Quick note entry">
              {Array.from({ length: 12 }, (_, index) => midiToNote((octave + 1) * 12 + index)).map((note) => (
                <button key={note} className={note.includes('#') ? 'sharp' : ''} onClick={() => setNote(selectedChannel, selectedRow, note)}>{note}</button>
              ))}
              <button className="clear-note" onClick={() => setNote(selectedChannel, selectedRow, null)}>clear</button>
            </div>
            <div className="cell-inspector">
              <label>Volume <input type="range" min="0" max="15" value={selectedCell.volume} onChange={(event) => commit((draft) => { draft.cells[selectedChannel][selectedRow].volume = Number(event.target.value) })} /><output>{selectedCell.volume.toString(16).toUpperCase()}</output></label>
              <label>Effect <input aria-label="Effect command" value={selectedCell.effect} maxLength={3} placeholder="0xy" onChange={(event) => { const value = event.target.value.toUpperCase().replace(/[^0-9A-FP-Z]/g, '').slice(0, 3); commit((draft) => { draft.cells[selectedChannel][selectedRow].effect = value }) }} /></label>
            </div>
            <p><kbd>A–K</kbd> enter notes · <kbd>Z/X</kbd> octave · <kbd>Del</kbd> clear · <kbd>Space</kbd> play</p>
          </div>
        </section>

        <section className="export-panel">
          <div><p className="eyebrow">Take it with you</p><h3>Open files. No lock-in.</h3><p>Chipvault JSON preserves every editor field. FamiTracker TXT imports into FamiTracker 0.4.6 and FamiStudio.</p></div>
          <div className="export-actions">
            <button className="primary-action" onClick={exportNative}><span>Editable project</span><small>.chipvault.json</small></button>
            <button className="primary-action" onClick={exportFami}><span>FamiTracker module</span><small>.famitracker.txt</small></button>
            <button onClick={() => importRef.current?.click()}><span>Import project</span><small>.json or .txt</small></button>
            <button className="danger-action" onClick={reset}><span>Fresh draft</span><small>clear local pattern</small></button>
            <input ref={importRef} type="file" accept=".json,.txt" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImport(file); event.target.value = '' }} />
          </div>
        </section>
        <footer><span>{message}</span><span>Built for preservation · no analytics · data stays local</span></footer>
      </main>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  )
}

function TrackerGrid({ project, playhead, selectedChannel, selectedRow, muted, onMute, onSelect, onClear }: {
  project: TrackerProject
  playhead: number
  selectedChannel: ChannelId
  selectedRow: number
  muted: Set<ChannelId>
  onMute: (id: ChannelId) => void
  onSelect: (id: ChannelId, row: number) => void
  onClear: (id: ChannelId, row: number) => void
}) {
  return (
    <div className="tracker-scroll">
      <table className="tracker-table">
        <thead><tr><th>ROW</th>{channels.map((channel) => <th key={channel.id} style={{ '--channel': channel.color } as React.CSSProperties}><button onClick={() => onMute(channel.id)} className={muted.has(channel.id) ? 'muted' : ''}><span>{channel.short}</span><small>{muted.has(channel.id) ? 'muted' : channel.name}</small></button></th>)}</tr></thead>
        <tbody>{Array.from({ length: project.rows }, (_, row) => (
          <tr key={row} className={playhead === row ? 'playing-row' : ''}>
            <th>{row.toString(16).padStart(2, '0').toUpperCase()}</th>
            {channels.map((channel) => {
              const cell = project.cells[channel.id][row]
              const selected = channel.id === selectedChannel && row === selectedRow
              return <td key={channel.id}><button className={selected ? 'selected-cell' : ''} onClick={() => onSelect(channel.id, row)} onDoubleClick={() => onClear(channel.id, row)} onContextMenu={(event) => { event.preventDefault(); onClear(channel.id, row) }}><b>{cell.note ?? '···'}</b><span>{cell.note ? cell.instrument.toString(16).padStart(2, '0').toUpperCase() : '··'} {cell.note ? cell.volume.toString(16).toUpperCase() : '·'} {cell.effect || '···'}</span></button></td>
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function PianoRoll({ project, channelId, selectedRow, onChannel, onSetNote }: {
  project: TrackerProject
  channelId: ChannelId
  selectedRow: number
  onChannel: (id: ChannelId) => void
  onSetNote: (id: ChannelId, row: number, note: string | null) => void
}) {
  const pitches = Array.from({ length: 36 }, (_, index) => midiToNote(83 - index))
  const notesByRow = new Map(project.cells[channelId].map((cell, row) => [row, cell.note]))
  return (
    <div className="piano-editor">
      <div className="piano-toolbar"><label>Editing<select value={channelId} onChange={(event) => onChannel(event.target.value as ChannelId)}>{channels.map((channel) => <option value={channel.id} key={channel.id}>{channel.name}</option>)}</select></label><span>Click to draw · click again to erase</span></div>
      <div className="piano-scroll">
        <div className="piano-grid" style={{ '--rows': project.rows } as React.CSSProperties}>
          {pitches.map((note) => <div className="piano-line" key={note}><span className={note.includes('#') ? 'black-key' : ''}>{note}</span><div className="piano-cells">{Array.from({ length: project.rows }, (_, row) => <button key={row} aria-label={`${note} at row ${row}`} className={`${notesByRow.get(row) === note ? 'placed' : ''} ${selectedRow === row ? 'selected-column' : ''}`} onClick={() => onSetNote(channelId, row, notesByRow.get(row) === note ? null : note)} />)}</div></div>)}
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
        <h2 id="about-title">The audio survived.<br />The patterns haven’t—yet.</h2>
        <p>YouTube stores the finished mix, not FamiTracker’s notes, channels, instruments, effects, or frame order. Reverse-engineering a mixed recording into an “original FTM” would be guesswork.</p>
        <p>Chipvault keeps those facts separate: the source audio is authentic; each editable module is a clearly labelled recovery draft. Import a recovered FamiTracker text module at any time, or transcribe against the recording using the tracker and piano roll.</p>
        <div className="dialog-facts"><div><strong>17</strong><span>music recordings</span></div><div><strong>8</strong><span>NES + VRC6 channels</span></div><div><strong>0</strong><span>fake “original” modules</span></div></div>
        <button className="primary-action dialog-action" onClick={onClose}>Back to the editor</button>
      </section>
    </div>
  )
}

export default App
