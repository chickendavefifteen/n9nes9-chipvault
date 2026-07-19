#!/usr/bin/env python3
"""Recover the played FamiTracker row raster and timing from a screen capture.

This is deliberately a deterministic first stage. It does not guess notes from
audio: it reads the fixed hexadecimal row counter in the captured tracker,
records every stable row transition, and emits an unrolled lossless raster for
the later token-OCR stage.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


ROW_COUNT = 0x40
ROW_HEIGHT = 12
ACTIVE_BAND_Y = 374
GLYPH_Y = ACTIVE_BAND_Y + 3
FIRST_DIGIT_X = 9
SECOND_DIGIT_X = 20
GLYPH_WIDTH = 10
GLYPH_HEIGHT = 8
REFERENCE_TIME = 5.0
REFERENCE_TOP_ROW = 0x01
REFERENCE_TOP_GLYPH_Y = 41
TRACKER_LEFT = 34
TRACKER_RIGHT = 1265


@dataclass
class DecodedFrame:
    frame_index: int
    timestamp: float
    row: int
    distance: float


def glyph_feature(image: np.ndarray, x: int, y: int) -> np.ndarray:
    """Return a colour-independent glyph feature.

    FamiTracker uses white row labels on a dark blue active-row background.
    Taking the minimum colour component suppresses that blue background while
    preserving the near-neutral anti-aliased label pixels.
    """

    patch = image[y : y + GLYPH_HEIGHT, x : x + GLYPH_WIDTH]
    neutral = patch.min(axis=2).astype(np.float32)
    neutral -= np.percentile(neutral, 10)
    scale = max(float(np.percentile(neutral, 95)), 1.0)
    return np.clip(neutral / scale, 0.0, 1.0)


def row_glyph_y(row: int) -> int:
    return REFERENCE_TOP_GLYPH_Y + (row - REFERENCE_TOP_ROW) * ROW_HEIGHT


def build_digit_templates(reference: np.ndarray) -> dict[int, list[np.ndarray]]:
    templates: dict[int, list[np.ndarray]] = {value: [] for value in range(16)}

    # The low digit cycles through every hexadecimal glyph in rows 10-1F.
    for value in range(16):
        row = 0x10 + value
        templates[value].append(
            glyph_feature(reference, SECOND_DIGIT_X, row_glyph_y(row))
        )

    # Add alternate compressed renderings from other visible rows where they
    # exist. This makes the classifier less sensitive to H.264 ringing.
    for row in range(0x01, 0x36):
        templates[row & 0x0F].append(
            glyph_feature(reference, SECOND_DIGIT_X, row_glyph_y(row))
        )

    # The high digit only needs 0-3 for a 64-row FamiTracker pattern.
    for row in (0x01, 0x10, 0x20, 0x30):
        templates[row >> 4].append(
            glyph_feature(reference, FIRST_DIGIT_X, row_glyph_y(row))
        )

    return templates


def classify(feature: np.ndarray, templates: dict[int, list[np.ndarray]]) -> tuple[int, float]:
    scores: list[tuple[float, int]] = []
    for value, variants in templates.items():
        if not variants:
            continue
        distance = min(float(np.mean((feature - template) ** 2)) for template in variants)
        scores.append((distance, value))
    distance, value = min(scores)
    return value, distance


def decode_row(image: np.ndarray, templates: dict[int, list[np.ndarray]]) -> tuple[int, float]:
    high, high_distance = classify(
        glyph_feature(image, FIRST_DIGIT_X, GLYPH_Y), templates
    )
    low, low_distance = classify(
        glyph_feature(image, SECOND_DIGIT_X, GLYPH_Y), templates
    )
    return high * 16 + low, max(high_distance, low_distance)


def read_reference(video_path: Path) -> np.ndarray:
    capture = cv2.VideoCapture(str(video_path))
    capture.set(cv2.CAP_PROP_POS_MSEC, REFERENCE_TIME * 1000)
    ok, frame = capture.read()
    capture.release()
    if not ok:
        raise RuntimeError(f"Could not read reference frame from {video_path}")
    return frame


def choose_middle(frames: list[DecodedFrame]) -> DecodedFrame:
    return min(
        frames,
        key=lambda frame: (
            abs(frame.frame_index - frames[len(frames) // 2].frame_index),
            frame.distance,
        ),
    )


def extract_runs(video_path: Path, templates: dict[int, list[np.ndarray]]) -> tuple[float, list[list[DecodedFrame]]]:
    capture = cv2.VideoCapture(str(video_path))
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    if fps <= 0:
        raise RuntimeError(f"Invalid frame rate for {video_path}")

    decoded: list[DecodedFrame] = []
    index = 0
    while True:
        ok, image = capture.read()
        if not ok:
            break
        row, distance = decode_row(image, templates)
        decoded.append(DecodedFrame(index, index / fps, row, distance))
        index += 1
    capture.release()

    raw_runs: list[list[DecodedFrame]] = []
    for frame in decoded:
        if not raw_runs or raw_runs[-1][-1].row != frame.row:
            raw_runs.append([frame])
        else:
            raw_runs[-1].append(frame)

    # A real row lasts about four 30 fps frames. Reject one-frame OCR glitches
    # by folding them into the neighbouring run when both neighbours agree.
    index = 1
    while index < len(raw_runs) - 1:
        current = raw_runs[index]
        if len(current) == 1 and raw_runs[index - 1][-1].row == raw_runs[index + 1][0].row:
            raw_runs[index - 1].extend(current)
            raw_runs[index - 1].extend(raw_runs[index + 1])
            del raw_runs[index : index + 2]
            continue
        index += 1

    return fps, raw_runs


def fit_timeline(runs: list[list[DecodedFrame]]) -> tuple[float, float, int]:
    """Fit transition time = offset + linear_row * seconds_per_row.

    Capture compression makes 8/B and A/B occasionally ambiguous and drops a
    few visual frames. A modulo-64 robust fit rejects those outliers instead of
    allowing one bad glyph to truncate the recovered song.
    """

    offset = 1.1
    seconds_per_row = 0.1333
    pairs: list[tuple[int, float]] = []
    for _ in range(5):
        pairs = []
        for run in runs[1:]:
            frame = run[0]
            linear_row = frame.row + ROW_COUNT * round(
                ((frame.timestamp - offset) / seconds_per_row - frame.row) / ROW_COUNT
            )
            residual = frame.timestamp - (offset + linear_row * seconds_per_row)
            if linear_row >= 1 and abs(residual) < 0.07:
                pairs.append((linear_row, frame.timestamp))
        x = np.array([pair[0] for pair in pairs], dtype=np.float64)
        y = np.array([pair[1] for pair in pairs], dtype=np.float64)
        seconds_per_row, offset = np.polyfit(x, y, 1)

    observed_rows = max(pair[0] for pair in pairs) + 1
    complete_rows = int(np.ceil(observed_rows / ROW_COUNT) * ROW_COUNT)
    return float(offset), float(seconds_per_row), complete_rows


def sample_unrolled_rows(
    video_path: Path,
    fps: float,
    offset: float,
    seconds_per_row: float,
    total_rows: int,
) -> tuple[list[np.ndarray], list[dict[str, int | float | str]]]:
    """Read each logical row from a non-highlighted neighbour in its order."""

    requests: dict[int, list[tuple[int, int, int]]] = {}
    for linear_row in range(total_rows):
        row = linear_row % ROW_COUNT
        # The capture ends during the final order, before a stable 3F frame.
        # Read the last six rows from below an earlier playhead instead.
        if row <= 0x39:
            viewer_linear_row = linear_row + 4
            source_y = ACTIVE_BAND_Y - 4 * ROW_HEIGHT
        else:
            viewer_linear_row = linear_row - 4
            source_y = ACTIVE_BAND_Y + 4 * ROW_HEIGHT
        sample_time = offset + (viewer_linear_row + 0.5) * seconds_per_row
        frame_index = max(0, round(sample_time * fps))
        requests.setdefault(frame_index, []).append((linear_row, source_y, viewer_linear_row))

    capture = cv2.VideoCapture(str(video_path))
    sampled: dict[int, tuple[np.ndarray, int, int]] = {}
    frame_index = 0
    last_request = max(requests)
    while frame_index <= last_request:
        ok, image = capture.read()
        if not ok:
            break
        for linear_row, source_y, viewer_linear_row in requests.get(frame_index, []):
            sampled[linear_row] = (
                image[source_y : source_y + ROW_HEIGHT, 0:TRACKER_RIGHT].copy(),
                frame_index,
                viewer_linear_row,
            )
        frame_index += 1
    capture.release()

    missing = sorted(set(range(total_rows)) - sampled.keys())
    if missing:
        raise RuntimeError(f"Could not sample logical rows: {missing[:12]}")

    rasters: list[np.ndarray] = []
    timeline: list[dict[str, int | float | str]] = []
    for linear_row in range(total_rows):
        raster, sample_frame, viewer_linear_row = sampled[linear_row]
        row = linear_row % ROW_COUNT
        rasters.append(raster)
        timeline.append(
            {
                "sequenceIndex": linear_row,
                "order": linear_row // ROW_COUNT,
                "row": row,
                "rowHex": f"{row:02X}",
                "start": round(offset + linear_row * seconds_per_row, 6),
                "end": round(offset + (linear_row + 1) * seconds_per_row, 6),
                "sample": round(sample_frame / fps, 6),
                "sampleFrame": sample_frame,
                "viewerSequenceIndex": viewer_linear_row,
            }
        )
    return rasters, timeline


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    reference = read_reference(args.video)
    templates = build_digit_templates(reference)
    fps, raw_runs = extract_runs(args.video, templates)
    offset, seconds_per_row, total_rows = fit_timeline(raw_runs)
    rasters, timeline = sample_unrolled_rows(
        args.video, fps, offset, seconds_per_row, total_rows
    )

    unrolled = np.vstack(rasters)
    cv2.imwrite(str(args.output / "unrolled-rows.png"), unrolled)
    (args.output / "timeline.json").write_text(
        json.dumps(
            {
                "video": str(args.video),
                "fps": fps,
                "playbackOffset": offset,
                "secondsPerRow": seconds_per_row,
                "rowHeight": ROW_HEIGHT,
                "trackerLeft": TRACKER_LEFT,
                "trackerRight": TRACKER_RIGHT,
                "rows": timeline,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    durations = np.array([float(row["end"]) - float(row["start"]) for row in timeline])
    print(f"Recovered {len(timeline)} rows across {len(timeline) // ROW_COUNT} orders")
    print(f"Playback: {timeline[0]['start']:.3f}s to {timeline[-1]['end']:.3f}s")
    print(
        "Row duration: "
        f"median={np.median(durations):.6f}s "
        f"min={durations.min():.6f}s max={durations.max():.6f}s"
    )
    print(f"Wrote {args.output / 'timeline.json'}")
    print(f"Wrote {args.output / 'unrolled-rows.png'}")


if __name__ == "__main__":
    main()
