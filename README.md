# N9NES9 Chipvault

An archive and modern browser tracker for the 17 music/demo uploads on the [N9NES9 YouTube channel](https://www.youtube.com/@n9nes9/videos).

The source recordings are preserved locally in the site. Each track also has an editable NES + VRC6 recovery project with a classic tracker grid, piano roll, keyboard entry, chip-synth preview, browser autosave, undo/redo, and optional exports. Opening the editor never starts a download.

## Recovery integrity

The audio recordings are authentic channel downloads. **Game Complete Loop** has the first video-frame recovery: two visible 64-row orders, source-audio synchronization, and confidence-labelled reconstructed instruments. The other editable patterns start blank until their recorded FamiTracker grids are transcribed. The UI labels both states everywhere they matter. A recovered module can be imported as either:

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

The published site is served from the generated `gh-pages` branch. The editable source remains on `main`.

## Content inventory

- 9 original tracks
- 7 cover arrangements with source credits retained where known
- 1 technique demo
- 2 tutorials documented but excluded from the music archive

See [SPEC.md](./SPEC.md) for the anchored requirements, acceptance checks, assumptions, and unknowns.

## Rights

The application source is MIT licensed. That license does not cover archived recordings, video thumbnails, or third-party compositions. See [AUDIO_RIGHTS.md](./AUDIO_RIGHTS.md).
