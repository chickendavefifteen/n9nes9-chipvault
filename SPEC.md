# N9NES9 Chipvault specification

## Overview

A static, offline-capable archive and modern browser tracker for the music uploads on the N9NES9 YouTube channel. The site preserves the source recordings, clearly distinguishes original work from covers and tutorials, and provides an honest recovery workspace rather than pretending compressed audio contains the lost FamiTracker project data.

## Observed facts

- The channel exposes 19 videos: 17 music/demo uploads and 2 tutorials.
- The uploads date from 2012 and were made in FamiTracker; many use VRC6.
- The descriptions contain one historical MediaFire FTM link. No live source module has yet been recovered.
- YouTube audio is a mixed render. It does not contain the original per-channel notes, instruments, effects, frames, or pattern order.

## Assumptions

- The operator owns the channel recordings and authorizes their archival download and publication.
- Covers should retain their original-composer credits and be labelled as covers.
- GitHub Pages may be public under the currently authenticated GitHub account.

## Requirements

- R1: Archive all 17 music/demo recordings locally with title, date, kind, credits, YouTube ID, and source URL.
- R2: Exclude the 2 tutorials from the music library while documenting them in the inventory.
- R3: Provide source-recording playback and one-click download.
- R4: Provide editable projects with NES + VRC6 channels, tempo/speed controls, per-channel mute, tracker rows, and a piano-roll editing mode.
- R5: Keep edits in a clearly marked working copy, save them locally only when the operator clicks Save, and support undo/redo, project reset, JSON import/export, and shareable project files.
- R6: Export standards-compliant FamiTracker 0.4.6 text modules importable by FamiTracker and FamiStudio.
- R7: Never represent audio-derived or empty recovery drafts as recovered original modules.
- R8: Build and deploy as a static GitHub Pages site with no backend, account, analytics, or tracking.
- R9: Work well with keyboard, mouse, touch, reduced motion, and narrow screens.
- R10: During recovered source playback, keep a fixed centre playhead while pattern rows move continuously past it at the source recording's row rate.
- R11: Present Play, Edit, and Export as the three obvious workspace actions; entering Play or Edit must never trigger a download.
- R12: Use a restrained animated neon-sunset background and compact layout without reducing tracker contrast, legibility, or interaction speed.
- R13: Match the recorded FamiTracker grid at token level: bright white notes, cobalt instruments, violet volume/effect data, and a blue-violet active row.
- R14: Mark every browser-authored cell edit clearly and persist that provenance in native Chipvault projects without leaking it into FamiTracker text exports.
- R15: Track changes, View/Edit changes, and tracker/piano changes must stop incompatible playback first and leave transport, audio, animation, and selected-row state coherent.
- R16: Pause playback when the document is hidden, resynchronise on return, and check a no-cache build manifest so stale tabs reload the current deployment.
- R17: Make the neon sunset deliberately brighter while retaining tracker contrast and disabling decorative motion for reduced-motion users.
- R18: Add an editable browser-synthesized Epic Sax Guy chiptune arrangement, clearly credited as a cover and limited to a ten-minute playback session; do not copy the original recording into the archive or misrepresent the arrangement as N9NES9 source material.
- R19: A Pages deployment must retain every hashed JS/CSS asset referenced by the previously deployed HTML; cached HTML must remain bootable for longer than GitHub Pages' ten-minute HTML cache window.
- R20: Never force-replace the Pages branch with an asset-pruning orphan commit. Deploy by overlaying the tested build onto the existing branch, verify both previous and current HTML asset references, then push normally.
- R21: Denied or unavailable browser storage must degrade to an in-memory workspace with a visible warning rather than preventing the React application from starting.
- R22: Support current Chrome, Edge, Firefox, and Safari with an ES2019 production target, avoid unsupported runtime-only conveniences where a simple compatible equivalent exists, and render a useful static/error fallback instead of a blank page.
- R23: Source playback and tracker animation must share one explicit transport lifecycle. Starting, playing, buffering, pausing, ending, looping, media failure, mode changes, track changes, and tab restoration must never leave the button, audio element, message, or animation disagreeing.
- R24: If source audio is rejected or stops advancing, automatically fall back to the chip engine after a bounded grace period; unlock that engine during the original user gesture so the fallback can still produce sound.
- R25: View-mode animation must follow source time for every local recording. Frame-recovered and audio-derived projects use their measured source timing and remain clearly confidence-labelled.
- R26: Only one current Chipvault tab may play at once. Current tabs coordinate with BroadcastChannel plus a storage-event fallback, and a newer idle build reloads itself on focus, visibility return, page restore, online recovery, or the bounded manifest poll.
- R27: Every historical hashed entrypoint observed in deployed or still-open tabs must remain resolvable. Cache-safe deployment aliases historical JS/CSS names to the newly tested bundle so stale HTML cannot revive obsolete playback code.
- R28: Because GitHub Pages forces a ten-minute document cache, every top-level navigation must immediately replace itself with a unique `fresh` query request, then remove only that token from the visible URL without another navigation. Reloading, revisiting, or opening an old bookmark must therefore obtain a fresh HTML document.
- R29: Selecting any of the 18 library entries must load a populated editable pattern with visible note keys. The 16 recordings without frame recovery use reproducible dominant-pitch/onset analysis of the preserved mix and must not be described as exact original modules.
- R30: Switching tracks must upgrade any older locally saved blank baseline when the shipped content revision is newer, without overwriting newer user edits.
- R31: Edit mode must separate the authentic source recording from the approximate editable chip preview, audition entered notes, show an explicit dirty working-copy state, and save to browser-local storage only through the visible Save action. A baseline upgrade must merge, not discard, cells already marked as user edits.
- R32: Any sound-affecting edit must automatically arm Edited preview for the next Play, place its playhead on the changed row, stop an incompatible source transport, and visibly identify that start row. Original mix remains available only as an explicit A/B selection after the edit.
- R33: Saving must return to Play mode with the saved edited pattern selected. Play and reload must use that locally saved pattern until the operator explicitly selects Original mix or resets it; export remains optional.
- R34: In the tracker, a mouse drag must select an inclusive rectangular range across rows and channels. Note entry, volume/effect changes, Delete/Backspace, and the visible Delete selected action must apply to the whole range as one undoable edit.
- R35: Edited playback for a preserved recording must retain the authentic recording as a synchronized backing layer and synthesize only browser-authored cells over it in both Edit and saved Play. The backing may duck only on edited rows so changed and deleted notes remain audible; source failure must fall back to the complete browser pattern.
- R36: The standalone browser fallback must synthesize audible DPCM/sample-channel percussion instead of silently discarding those cells.

## Acceptance checks

- C1: The manifest contains 17 unique music video IDs and 2 documented tutorial IDs.
- C2: Every manifest audio and poster path exists in the production output.
- C3: Unit tests prove project round-tripping and required FamiTracker text structure.
- C4: TypeScript passes and Vite creates a production build.
- C5: Browser smoke test proves library selection, reference playback element, note editing, transport, export controls, and responsive layout.
- C6: The deployed Pages URL returns HTTP 200 and its asset URLs resolve.
- C7: A scrub finds no secrets, credentials, cookies, or private personal data in tracked files.
- C8: A browser playback check samples the tracker scroll position multiple times and proves continuous movement while the page scroll position stays fixed.
- C9: The centre playhead remains at a stable viewport coordinate while its order/row label advances with the recording.
- C10: Desktop and narrow-screen browser checks expose unique Play, Edit, and Export controls without page-level horizontal overflow.
- C11: `prefers-reduced-motion` disables decorative sunset/grid motion and smooth tracker scrolling.
- C12: Browser tests prove note, instrument, volume, and effect tokens have distinct high-contrast colors and edited cells retain an explicit user-edit marker.
- C13: Unit and browser tests prove track/mode switching stops orphaned playback, hidden-tab recovery leaves animation coherent, and the build manifest requests a reload only for a genuinely newer build.
- C14: The bonus entry opens a populated VRC6 tracker arrangement, plays through the browser chip engine, can be edited/exported, credits the source performance, and stops after a maximum ten-minute session.
- C15: A stale copy of the previous deployed `index.html` can request each of its hashed assets from the new Pages deployment and receive HTTP 200.
- C16: The deploy script fails before pushing if an asset referenced by either the previous or current HTML is absent from the candidate Pages tree.
- C17: Unit tests prove storage read/write failures are contained, project cloning works without `structuredClone`, and stale/current HTML asset references are extracted correctly.
- C18: Production build, cold-root browser boot, source playback, fixed-playhead motion, editing, track/mode switching, and the synthesized bonus pass with no uncaught browser errors.
- C19: Unit tests prove source position for recovered and draft projects, bounded stall detection, visible-loop restart, cross-tab signal validation, and safe reload-vs-notify update decisions.
- C20: Browser tests prove six consecutive pause/resume cycles keep media, transport label, moving rows, and fixed playhead coherent.
- C21: Browser tests force source playback to its end and prove Loop restarts both sound and animation instead of leaving an ended or stale-playing state.
- C22: Browser tests prove a stalled/rejected source enters audible chip fallback and that switching mode, track, or active tab leaves no orphaned playback.
- C23: Reload tests cover every open historical tab and at least ten cold/current reloads; each must boot the current build with no startup or console error.
- C24: Deployment proof returns HTTP 200 for every current, previous, and historical entrypoint, and byte hashes prove all historical aliases contain the current tested JS/CSS bundle.
- C25: Unit tests prove every library entry returns a populated baseline, every audio-derived draft has melody/bass/rhythm data, and the bonus has recognizable lead, harmony, bass, and drums.
- C26: Browser tests click through all 18 entries and prove the heading, recovery label, tracker table, and non-empty notes update every time.
- C27: Repeated root reloads prove the navigation bootstrap requests a new `fresh` URL on every load, cleans the visible URL, retains the selected hash, and boots the current build with no redirect loop.
- C28: Browser tests prove an edited note is visibly marked, reports a completed browser-local save, survives a reload and a track round trip, and can be heard separately through the labelled edited-chip preview while the labelled original-mix preview remains authentic.
- C29: Browser tests begin in Original mix, edit a known cell to a different pitch, prove the active preview and Play label switch automatically, prove playback begins on that cell and advances under `chip-preview`, then explicitly switch back to Original mix and prove source playback remains available.
- C30: Browser tests drag across a two-channel by three-row rectangle, prove six cells are selected, fill all six with one note, delete all six, undo the batch once, and retain one visible dirty state throughout the unsaved working copy.
- C31: Browser tests save the edited working copy, prove Edit closes into Play with Edited preview active, play the changed sound and moving rows, reload, and prove the saved cell values and Edited preview selection persist without invoking Export.
- C32: Browser tests edit a source-backed cell and prove Edit, Save-to-Play, and reload all enter `layered-preview` with the media element advancing, the backing marked active, and tracker rows moving; explicitly selecting Original mix still enters `source-playing`.
- C33: Unit tests prove row-to-source-time inversion, tempo-aligned source playback rate, and an audible DPCM/sample trigger in the standalone fallback.

## Out of scope for this recovery pass

- Claiming exact note-for-note recovery without original FTM files or completed video-frame transcription.
- Binary `.ftm` generation in-browser. The interoperable export is FamiTracker's official text module format (`.txt`).
- Republishing the two tutorial videos.

## Falsifiers and unknowns

- A recovered original `.ftm` falsifies the corresponding `recoveryStatus: source-missing` entry and should replace the draft.
- Visual transcription from the screen recordings may recover exact patterns, but frame order, hidden instruments, macros, and off-screen effects still require verification.
- Cover redistribution rights are not proven by channel ownership alone; credits and source links are preserved, but the operator remains responsible for rights clearance.
