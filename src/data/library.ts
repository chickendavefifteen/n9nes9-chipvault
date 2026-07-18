import type { ChannelDefinition, LibraryTrack } from '../types'

export const channels: ChannelDefinition[] = [
  { id: 'pulse1', name: 'Pulse 1', short: 'P1', color: '#ffca6a', oscillator: 'square' },
  { id: 'pulse2', name: 'Pulse 2', short: 'P2', color: '#f08baa', oscillator: 'square' },
  { id: 'triangle', name: 'Triangle', short: 'TRI', color: '#79d8b2', oscillator: 'triangle' },
  { id: 'noise', name: 'Noise', short: 'NOI', color: '#b5a6ff', oscillator: 'noise' },
  { id: 'dpcm', name: 'DPCM', short: 'DMC', color: '#a2b1bd', oscillator: 'sample' },
  { id: 'vrc6Pulse1', name: 'VRC6 Pulse 1', short: 'V1', color: '#ff885e', oscillator: 'square' },
  { id: 'vrc6Pulse2', name: 'VRC6 Pulse 2', short: 'V2', color: '#7bc8ff', oscillator: 'square' },
  { id: 'vrc6Saw', name: 'VRC6 Saw', short: 'SAW', color: '#b8e85d', oscillator: 'sawtooth' },
]

export const tutorials = [
  { id: '_lqGpO_8sqY', title: 'Very Basic Introduction', sourceUrl: 'https://www.youtube.com/watch?v=_lqGpO_8sqY' },
  { id: '0qSR6oFCojM', title: 'Arpeggios', sourceUrl: 'https://www.youtube.com/watch?v=0qSR6oFCojM' },
]

export const library: LibraryTrack[] = [
  {
    id: 'Z_kTjfJLneY', slug: 'interstellar-odyssey', title: 'FamiTracker - Interstellar Odyssey (Original)', shortTitle: 'Interstellar Odyssey',
    kind: 'original', duration: 104, uploaded: '2012-12-17', expansion: 'VRC6',
    description: 'Written for a friend’s Android game.', sourceUrl: 'https://www.youtube.com/watch?v=Z_kTjfJLneY',
    audio: 'audio/Z_kTjfJLneY.m4a', poster: 'posters/Z_kTjfJLneY.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'gls1CjId7YA', slug: 'ma-petite-fleur', title: 'FamiTracker - “Ma Petite Fleur” by Radix (Cover)', shortTitle: 'Ma Petite Fleur',
    kind: 'cover', duration: 103, uploaded: '2012-10-02', expansion: '2A03', credit: 'Original composition by Radix.',
    description: 'A FamiTracker arrangement of the Radix track.', sourceUrl: 'https://www.youtube.com/watch?v=gls1CjId7YA',
    audio: 'audio/gls1CjId7YA.m4a', poster: 'posters/gls1CjId7YA.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'h4YH5tk64_U', slug: 'game-complete', title: 'FamiTracker - GameComplete', shortTitle: 'Game Complete',
    kind: 'original', duration: 86, uploaded: '2012-04-05', expansion: 'VRC6',
    description: 'A VRC6 game track.', sourceUrl: 'https://www.youtube.com/watch?v=h4YH5tk64_U',
    audio: 'audio/h4YH5tk64_U.m4a', poster: 'posters/h4YH5tk64_U.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'RqBeLtTf-ZM', slug: 'somewhere-up-there', title: 'FamiTracker - SomewhereUpThere', shortTitle: 'Somewhere Up There',
    kind: 'original', duration: 74, uploaded: '2012-04-05', expansion: 'VRC6',
    description: 'A quick VRC6 track made for a game.', sourceUrl: 'https://www.youtube.com/watch?v=RqBeLtTf-ZM',
    audio: 'audio/RqBeLtTf-ZM.m4a', poster: 'posters/RqBeLtTf-ZM.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'JEz7XyGUcBk', slug: 'silicon-memories', title: 'FamiTracker - SiliconMemories', shortTitle: 'Silicon Memories',
    kind: 'original', duration: 107, uploaded: '2012-04-05', expansion: 'VRC6',
    description: 'A simple VRC6 loop.', sourceUrl: 'https://www.youtube.com/watch?v=JEz7XyGUcBk',
    audio: 'audio/JEz7XyGUcBk.m4a', poster: 'posters/JEz7XyGUcBk.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'wDuDCeP3cZk', slug: 'pwm-arpeggios-demo', title: 'FamiTracker - PWM Arpeggios Demo', shortTitle: 'PWM Arpeggios Demo',
    kind: 'demo', duration: 240, uploaded: '2012-04-05', expansion: '2A03',
    description: 'Pulse-width modulation combined with effect-column arpeggios.', sourceUrl: 'https://www.youtube.com/watch?v=wDuDCeP3cZk',
    audio: 'audio/wDuDCeP3cZk.m4a', poster: 'posters/wDuDCeP3cZk.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'tIqtbXU0H0Y', slug: 'nebula-jam', title: 'FamiTracker - NebulaJam', shortTitle: 'Nebula Jam',
    kind: 'original', duration: 75, uploaded: '2012-04-05', expansion: 'VRC6',
    description: 'A VRC6 game track.', sourceUrl: 'https://www.youtube.com/watch?v=tIqtbXU0H0Y',
    audio: 'audio/tIqtbXU0H0Y.m4a', poster: 'posters/tIqtbXU0H0Y.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'cRssJBFKkyE', slug: 'unreal-superhero-2', title: 'FamiTracker - Unreal Superhero 2 (Cover)', shortTitle: 'Unreal Superhero 2',
    kind: 'cover', duration: 78, uploaded: '2012-04-05', expansion: 'VRC6', credit: 'Original composition by Rez / eclipse + tpolm.',
    description: 'VRC6 arrangement with old-school synthesized drums.', sourceUrl: 'https://www.youtube.com/watch?v=cRssJBFKkyE',
    audio: 'audio/cRssJBFKkyE.m4a', poster: 'posters/cRssJBFKkyE.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'ItwTYITUwMk', slug: 'millennium-chip', title: 'FamiTracker - Millennium Chip (Cover)', shortTitle: 'Millennium Chip',
    kind: 'cover', duration: 103, uploaded: '2012-04-05', expansion: '2A03', credit: 'Original tracker module credited to edZes / Norwaves (1999).',
    description: 'FamiTracker cover with an intro and tempo change.', sourceUrl: 'https://www.youtube.com/watch?v=ItwTYITUwMk',
    audio: 'audio/ItwTYITUwMk.m4a', poster: 'posters/ItwTYITUwMk.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: '5PmmiS4Di00', slug: 'unfriendly-space', title: 'FamiTracker - UnfriendlySpace', shortTitle: 'Unfriendly Space',
    kind: 'original', duration: 57, uploaded: '2012-04-05', expansion: 'VRC6',
    description: 'A VRC6 loop made for a game.', sourceUrl: 'https://www.youtube.com/watch?v=5PmmiS4Di00',
    audio: 'audio/5PmmiS4Di00.m4a', poster: 'posters/5PmmiS4Di00.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'VaVm4wYV2s0', slug: 'knas', title: 'FamiTracker - Knas (Cover)', shortTitle: 'Knas',
    kind: 'cover', duration: 111, uploaded: '2012-04-05', expansion: '2A03', credit: 'Original XM credited in the upload to Zaiko of Torment.',
    description: 'A FamiTracker replica of the Tam/CORE keygen track.', sourceUrl: 'https://www.youtube.com/watch?v=VaVm4wYV2s0',
    audio: 'audio/VaVm4wYV2s0.m4a', poster: 'posters/VaVm4wYV2s0.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'TejsLqPt0-k', slug: 'game-complete-loop', title: 'FamiTracker - Game Complete Loop (Original)', shortTitle: 'Game Complete Loop',
    kind: 'original', duration: 48, uploaded: '2012-04-05', expansion: 'VRC6',
    description: 'A short 12-second loop written for an assignment game.', sourceUrl: 'https://www.youtube.com/watch?v=TejsLqPt0-k',
    audio: 'audio/TejsLqPt0-k.m4a', poster: 'posters/TejsLqPt0-k.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'J9TnXwQS7e4', slug: 'dead-feelings', title: 'FamiTracker - Dead Feelings (Cover)', shortTitle: 'Dead Feelings',
    kind: 'cover', duration: 160, uploaded: '2012-04-05', expansion: 'VRC6', credit: 'Original composition credited in the upload to #Carter / Outbreak.',
    description: 'A FamiTracker keygen cover. The historical FTM download link in the video description is no longer confirmed live.', sourceUrl: 'https://www.youtube.com/watch?v=J9TnXwQS7e4',
    audio: 'audio/J9TnXwQS7e4.m4a', poster: 'posters/J9TnXwQS7e4.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'AVXbP-TXoyQ', slug: 'tport-keygen', title: 'FamiTracker - tPort Keygen (Cover)', shortTitle: 'tPort Keygen',
    kind: 'cover', duration: 118, uploaded: '2012-04-05', expansion: '2A03', credit: 'Original composer unknown; sourced from the PHP Designer 5.3.2kg keygen.',
    description: 'A FamiTracker arrangement of a favourite keygen track.', sourceUrl: 'https://www.youtube.com/watch?v=AVXbP-TXoyQ',
    audio: 'audio/AVXbP-TXoyQ.m4a', poster: 'posters/AVXbP-TXoyQ.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: '3M7EBppyzNo', slug: 'techno-keygen-track', title: 'FamiTracker - Techno Keygen Track (Original)', shortTitle: 'Techno Keygen Track',
    kind: 'original', duration: 92, uploaded: '2012-04-05', expansion: 'VRC6',
    description: 'A quick techno-style original using VRC6.', sourceUrl: 'https://www.youtube.com/watch?v=3M7EBppyzNo',
    audio: 'audio/3M7EBppyzNo.m4a', poster: 'posters/3M7EBppyzNo.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'w9AdIUbtxcs', slug: 'rainy-summerdays', title: 'FamiTracker - Rainy Summerdays by Radix (Cover)', shortTitle: 'Rainy Summerdays',
    kind: 'cover', duration: 160, uploaded: '2012-04-05', expansion: '2A03', credit: 'Original composition by Radix.',
    description: 'A detailed FamiTracker arrangement of the Radix track.', sourceUrl: 'https://www.youtube.com/watch?v=w9AdIUbtxcs',
    audio: 'audio/w9AdIUbtxcs.m4a', poster: 'posters/w9AdIUbtxcs.jpg', recoveryStatus: 'source-missing',
  },
  {
    id: 'gVHCm-fxF5g', slug: 'dark-moon-city', title: 'FamiTracker - Dark Moon City (Original)', shortTitle: 'Dark Moon City',
    kind: 'original', duration: 74, uploaded: '2012-04-05', expansion: 'VRC6',
    description: 'Level background music written for an assignment game.', sourceUrl: 'https://www.youtube.com/watch?v=gVHCm-fxF5g',
    audio: 'audio/gVHCm-fxF5g.m4a', poster: 'posters/gVHCm-fxF5g.jpg', recoveryStatus: 'source-missing',
  },
]
