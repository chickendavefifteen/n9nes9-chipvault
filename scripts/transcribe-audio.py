#!/usr/bin/env python3
"""Generate compact tracker drafts from the preserved mixes.

This is deliberately a reproducible, conservative pitch extraction pass rather
than a claim that the original FamiTracker modules were recovered. It uses only
FFmpeg and NumPy so the generated baseline can be refreshed without a hosted
transcription service.
"""

from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / "public" / "audio"
OUTPUT = ROOT / "src" / "data" / "audio-transcriptions.json"
SAMPLE_RATE = 12_000
ROWS = 128
FFT_SIZE = 4096


def decode(path: Path) -> np.ndarray:
    command = [
        "ffmpeg", "-v", "error", "-i", str(path), "-t", "24", "-ac", "1",
        "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1",
    ]
    result = subprocess.run(command, check=True, capture_output=True)
    samples = np.frombuffer(result.stdout, dtype=np.float32).astype(np.float64)
    samples -= float(np.mean(samples))
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    return samples / peak if peak > 0 else samples


def frame_rms(samples: np.ndarray, frame: int = 512, hop: int = 256) -> np.ndarray:
    if samples.size < frame:
        return np.zeros(1)
    count = 1 + (samples.size - frame) // hop
    shape = (count, frame)
    strides = (samples.strides[0] * hop, samples.strides[0])
    windows = np.lib.stride_tricks.as_strided(samples, shape=shape, strides=strides)
    return np.sqrt(np.mean(windows * windows, axis=1) + 1e-12)


def find_audio_offset(samples: np.ndarray) -> float:
    rms = frame_rms(samples)
    threshold = max(0.008, float(np.percentile(rms, 90)) * 0.12)
    active = np.flatnonzero(rms > threshold)
    if active.size == 0:
        return 0.0
    return max(0.0, float(active[0] * 256 / SAMPLE_RATE) - 0.08)


def estimate_tempo(samples: np.ndarray) -> int:
    rms = frame_rms(samples)
    onset = np.maximum(np.diff(rms, prepend=rms[0]), 0.0)
    if float(np.max(onset)) <= 1e-9:
        return 150
    onset /= float(np.max(onset))
    hop_seconds = 256 / SAMPLE_RATE
    best_bpm, best_score = 150, -1.0
    for bpm in range(96, 181):
        lag = max(1, round(60 / bpm / hop_seconds))
        if lag >= onset.size // 2:
            continue
        primary = float(np.dot(onset[:-lag], onset[lag:]))
        double = float(np.dot(onset[:-(lag * 2)], onset[lag * 2:])) if lag * 2 < onset.size else 0.0
        score = primary + double * 0.35
        # Prefer a musically plausible central tempo when correlations are close.
        score *= 1.0 - min(0.12, abs(bpm - 138) / 1000)
        if score > best_score:
            best_bpm, best_score = bpm, score
    return best_bpm


def midi_note(midi: int) -> str:
    names = ("C-", "C#", "D-", "D#", "E-", "F-", "F#", "G-", "G#", "A-", "A#", "B-")
    return f"{names[midi % 12]}{midi // 12 - 1}"


def pitch_scores(magnitude: np.ndarray, low: int, high: int) -> list[tuple[float, int]]:
    bin_hz = SAMPLE_RATE / FFT_SIZE
    scored: list[tuple[float, int]] = []
    for midi in range(low, high + 1):
        frequency = 440.0 * 2 ** ((midi - 69) / 12)
        score = 0.0
        for harmonic, weight in ((1, 1.0), (2, 0.55), (3, 0.30), (4, 0.18)):
            index = round(frequency * harmonic / bin_hz)
            if 1 <= index < magnitude.size - 1:
                score += float(np.max(magnitude[index - 1:index + 2])) * weight
        scored.append((score, midi))
    return sorted(scored, reverse=True)


def transcribe(path: Path) -> dict[str, object]:
    samples = decode(path)
    offset = find_audio_offset(samples)
    tempo = estimate_tempo(samples)
    seconds_per_row = 60 / tempo / 4
    window = np.hanning(FFT_SIZE)
    melody: list[str | None] = []
    harmony: list[str | None] = []
    bass: list[str | None] = []
    noise: list[str | None] = []
    confidences: list[float] = []
    previous_melody: int | None = None

    row_energy: list[float] = []
    spectra: list[np.ndarray] = []
    for row in range(ROWS):
        centre = round((offset + (row + 0.5) * seconds_per_row) * SAMPLE_RATE)
        start = centre - FFT_SIZE // 2
        frame = np.zeros(FFT_SIZE)
        source_start = max(0, start)
        source_end = min(samples.size, start + FFT_SIZE)
        if source_end > source_start:
            target_start = source_start - start
            frame[target_start:target_start + source_end - source_start] = samples[source_start:source_end]
        row_energy.append(float(np.sqrt(np.mean(frame * frame))))
        spectra.append(np.abs(np.fft.rfft(frame * window)))

    energy_floor = max(0.002, float(np.percentile(row_energy, 25)) * 0.6)
    onset = np.maximum(np.diff(row_energy, prepend=row_energy[0]), 0.0)
    onset_threshold = float(np.percentile(onset, 68))

    for row, magnitude in enumerate(spectra):
        if row_energy[row] <= energy_floor:
            melody.append(None)
            harmony.append(None)
            bass.append(None)
            noise.append(None)
            continue

        lead_ranked = pitch_scores(magnitude, 48, 88)
        bass_ranked = pitch_scores(magnitude, 30, 57)
        lead_score, lead_midi = lead_ranked[0]
        median_score = float(np.median([score for score, _ in lead_ranked])) + 1e-9
        confidence = max(0.0, min(1.0, (lead_score - median_score) / (lead_score + median_score)))
        confidences.append(confidence)

        # Keep note changes and an audible retrigger at least every other row.
        emit_lead = lead_midi != previous_melody or row % 2 == 0
        melody.append(midi_note(lead_midi) if emit_lead else None)
        previous_melody = lead_midi

        second = next((midi for _, midi in lead_ranked[1:] if abs(midi - lead_midi) not in (0, 1, 11, 12, 13)), lead_midi - 12)
        harmony.append(midi_note(second) if row % 2 == 1 else None)
        bass.append(midi_note(bass_ranked[0][1]) if row % 4 == 0 else None)
        hit = onset[row] >= onset_threshold or row % 8 == 0
        noise.append(("C-#" if row % 8 == 0 else "6-#") if hit else None)

    mean_confidence = float(np.mean(confidences)) if confidences else 0.0
    return {
        "tempo": tempo,
        "rows": ROWS,
        "audioOffset": round(offset, 4),
        "secondsPerRow": round(seconds_per_row, 7),
        "confidence": round(0.32 + mean_confidence * 0.34, 3),
        "melody": melody,
        "harmony": harmony,
        "bass": bass,
        "noise": noise,
    }


def main() -> None:
    result: dict[str, object] = {}
    for path in sorted(AUDIO.glob("*.m4a")):
        result[path.stem] = transcribe(path)
        data = result[path.stem]
        note_count = sum(value is not None for key in ("melody", "harmony", "bass", "noise") for value in data[key])
        print(f"{path.stem}: tempo={data['tempo']} confidence={data['confidence']} notes={note_count}")
    OUTPUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main()
