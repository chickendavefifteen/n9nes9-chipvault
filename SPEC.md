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
- R5: Autosave edits locally and support undo/redo, project reset, JSON import/export, and shareable project files.
- R6: Export standards-compliant FamiTracker 0.4.6 text modules importable by FamiTracker and FamiStudio.
- R7: Never represent audio-derived or empty recovery drafts as recovered original modules.
- R8: Build and deploy as a static GitHub Pages site with no backend, account, analytics, or tracking.
- R9: Work well with keyboard, mouse, touch, reduced motion, and narrow screens.
- R10: During recovered source playback, keep a fixed centre playhead while pattern rows move continuously past it at the source recording's row rate.
- R11: Present View, Edit, and Export as the three obvious workspace actions; entering View or Edit must never trigger a download.
- R12: Use a restrained animated neon-sunset background and compact layout without reducing tracker contrast, legibility, or interaction speed.
- R13: Match the recorded FamiTracker grid at token level: bright white notes, cobalt instruments, violet volume/effect data, and a blue-violet active row.
- R14: Mark every browser-authored cell edit clearly and persist that provenance in native Chipvault projects without leaking it into FamiTracker text exports.
- R15: Track changes, View/Edit changes, and tracker/piano changes must stop incompatible playback first and leave transport, audio, animation, and selected-row state coherent.
- R16: Pause playback when the document is hidden, resynchronise on return, and check a no-cache build manifest so stale tabs reload the current deployment.
- R17: Make the neon sunset deliberately brighter while retaining tracker contrast and disabling decorative motion for reduced-motion users.
- R18: Add an Epic Sax Guy bonus as an official externally embedded YouTube performance limited to a ten-minute session; do not copy it into the downloadable archive or misrepresent it as N9NES9 source material.
- R19: A Pages deployment must retain every hashed JS/CSS asset referenced by the previously deployed HTML; cached HTML must remain bootable for longer than GitHub Pages' ten-minute HTML cache window.
- R20: Never force-replace the Pages branch with an asset-pruning orphan commit. Deploy by overlaying the tested build onto the existing branch, verify both previous and current HTML asset references, then push normally.
- R21: Denied or unavailable browser storage must degrade to an in-memory workspace with a visible warning rather than preventing the React application from starting.
- R22: Support current Chrome, Edge, Firefox, and Safari with an ES2019 production target, avoid unsupported runtime-only conveniences where a simple compatible equivalent exists, and render a useful static/error fallback instead of a blank page.

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
- C10: Desktop and narrow-screen browser checks expose unique View, Edit, and Export controls without page-level horizontal overflow.
- C11: `prefers-reduced-motion` disables decorative sunset/grid motion and smooth tracker scrolling.
- C12: Browser tests prove note, instrument, volume, and effect tokens have distinct high-contrast colors and edited cells retain an explicit user-edit marker.
- C13: Unit and browser tests prove track/mode switching stops orphaned playback, hidden-tab recovery leaves animation coherent, and the build manifest requests a reload only for a genuinely newer build.
- C14: The bonus entry embeds the official Eurovision-hosted video for a ten-minute session and exposes no archive-audio download or project-export claim.
- C15: A stale copy of the previous deployed `index.html` can request each of its hashed assets from the new Pages deployment and receive HTTP 200.
- C16: The deploy script fails before pushing if an asset referenced by either the previous or current HTML is absent from the candidate Pages tree.
- C17: Unit tests prove storage read/write failures are contained, project cloning works without `structuredClone`, and stale/current HTML asset references are extracted correctly.
- C18: Production build, cold-root browser boot, source playback, fixed-playhead motion, editing, track/mode switching, and the external bonus pass with no uncaught browser errors.

## Out of scope for this recovery pass

- Claiming exact note-for-note recovery without original FTM files or completed video-frame transcription.
- Binary `.ftm` generation in-browser. The interoperable export is FamiTracker's official text module format (`.txt`).
- Republishing the two tutorial videos.

## Falsifiers and unknowns

- A recovered original `.ftm` falsifies the corresponding `recoveryStatus: source-missing` entry and should replace the draft.
- Visual transcription from the screen recordings may recover exact patterns, but frame order, hidden instruments, macros, and off-screen effects still require verification.
- Cover redistribution rights are not proven by channel ownership alone; credits and source links are preserved, but the operator remains responsible for rights clearance.
