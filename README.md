# N9NES9 Chipvault

An archive and modern browser tracker for the 17 music/demo uploads on the [N9NES9 YouTube channel](https://www.youtube.com/@n9nes9/videos).

The source recordings are preserved locally in the site. Each track also has an editable NES + VRC6 recovery project with a classic tracker grid, piano roll, keyboard entry, chip-synth preview, browser autosave, undo/redo, and optional exports. Opening the editor never starts a download.

## Recovery integrity

The audio recordings are authentic channel downloads. **Game Complete Loop** has the first video-frame recovery: two visible 64-row orders, source-audio synchronization, and confidence-labelled reconstructed instruments. The other recordings now open populated, editable audio-derived drafts generated from dominant-pitch and onset analysis of the preserved mix. These are explicitly labelled as lower-confidence drafts rather than lost original modules. A project can be imported as either:

- Chipvault JSON (`.chipvault.json`) for lossless browser-editor round trips.
- FamiTracker 0.4.6 text (`.txt`) for FamiTracker/FamiStudio interoperability.

The editor exports the same two formats, including multi-pattern FamiTracker text round trips. Export is a separate optional action. It does not invent a binary `.ftm` wrapper.

The application itself is cloud-hosted on GitHub Pages. Working copies currently persist in the browser; genuine cross-device saving requires a writable authenticated backend and is deliberately not misrepresented as active.

## Local development

```powershell
npm install
npm test
npm run dev
```

Production proof:

```powershell
npm test
npm run build
```

Deploy only with:

```powershell
npm run deploy:pages
```

The deploy command tests and builds first, overlays `dist` onto the existing `gh-pages` branch, and refuses to push if the previous, current, or known historical HTML references a missing hashed asset. Historical entrypoint names are refreshed with the current tested bundle. GitHub Pages forces a ten-minute document cache, so the inline navigation bootstrap requests a unique `fresh` URL on every visit/reload and then restores the clean visible URL without a second navigation. Do not force-replace the Pages branch.

Playback is intentionally single-tab: starting sound in one current Chipvault tab pauses any other current tab. Source audio drives the tracker animation for every recording, loops when Loop is enabled, and falls back to the already-unlocked chip engine if browser media playback is rejected or stalls.

The published site is served from the generated `gh-pages` branch. The editable source remains on the source branch and is reviewed through a pull request.

## Content inventory

- 9 original tracks
- 7 cover arrangements with source credits retained where known
- 1 technique demo
- 1 editable VRC6-style Epic Sax Guy bonus arrangement with no copied source recording
- 2 tutorials documented but excluded from the music archive

See [SPEC.md](./SPEC.md) for the anchored requirements, acceptance checks, assumptions, and unknowns.

## Rights

The application source is MIT licensed. That license does not cover archived recordings, video thumbnails, or third-party compositions. See [AUDIO_RIGHTS.md](./AUDIO_RIGHTS.md).
