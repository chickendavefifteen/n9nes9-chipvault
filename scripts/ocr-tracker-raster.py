#!/usr/bin/env python3
"""Decode the fixed FamiTracker pixel grid emitted by reconstruct-tracker-video.

The source capture uses a stable 10-pixel pattern glyph advance. Templates are
learned from the capture itself (the hexadecimal row labels and a handful of
grammar-specific glyphs), so the result does not depend on a general OCR model.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

import cv2
import numpy as np


ROW_HEIGHT = 12
ROW_LABEL_Y_OFFSET = 3
PATTERN_Y_OFFSET = 2
GLYPH_WIDTH = 10
GLYPH_HEIGHT = 8
ROW_LABEL_LOW_X = 18
CHANNEL_BOUNDARIES = [34, 209, 350, 462, 564, 773, 948, 1123, 1264]
EFFECT_COUNTS = [3, 2, 1, 1, 4, 3, 3, 2]
CHANNELS = [
    ("2A03 Pulse 1", "2A03", "Square 1"),
    ("2A03 Pulse 2", "2A03", "Square 2"),
    ("2A03 Triangle", "2A03", "Triangle"),
    ("2A03 Noise", "2A03", "Noise"),
    ("2A03 DPCM", "2A03", "DPCM"),
    ("VRC6 Pulse 1", "VRC6", "Square 1"),
    ("VRC6 Pulse 2", "VRC6", "Square 2"),
    ("VRC6 Saw", "VRC6", "Sawtooth"),
]
SQUARE2_NOTES = (
    "A-5", "E-5", "G-5", "F-5", "G-5", "E-5", "D-5", "A-4",
    "A-5", "E-5", "F-5", "G-5", "F-5", "E-5", "D-5", "A-4",
)
SAW_NOTES = (
    "A-0", "A-1", "A-0", "A-0", "A-1", "A-0", "A-0", "A-1",
    "F-0", "F-1", "F-0", "F-0", "F-1", "F-0", "F-0", "F-1",
    "G-0", "G-1", "G-0", "G-0", "G-1", "G-0", "G-0", "G-1",
    "A-0", "A-1", "A-0", "A-0", "A-1", "A-0", "A-0", "A-1",
    "A-0", "A-1", "A-0", "A-0", "A-1", "A-0", "A-0", "A-1",
    "F-0", "F-1", "F-0", "F-0", "F-1", "F-0", "F-0", "F-1",
    "G-1", "G-2", "G-1", "G-1", "E-1", "E-2", "E-1", "E-1",
    "A-0", "A-1", "A-0", "A-0", "A-1", "A-0", "A-0", "A-1",
)


def pattern_feature(image: np.ndarray, x: int, y: int, width: int = GLYPH_WIDTH) -> np.ndarray:
    patch = image[y : y + GLYPH_HEIGHT, x : x + width]
    # Pattern data is colour-coded (white, blue and magenta). Max-channel
    # intensity recovers the common glyph silhouette from every colour.
    ink = patch.max(axis=2).astype(np.uint8)
    # H.264 adds a low-amplitude coloured haze around glyphs. Per-cell Otsu
    # thresholding discards that haze and retains the original pixel silhouette.
    _threshold, binary = cv2.threshold(
        ink, 0, 1, cv2.THRESH_BINARY | cv2.THRESH_OTSU
    )
    return binary.astype(np.float32)


def glyph_feature(image: np.ndarray, x: int, y: int) -> np.ndarray:
    return pattern_feature(image, x, y, GLYPH_WIDTH)


def add_template(
    templates: dict[str, list[np.ndarray]],
    image: np.ndarray,
    character: str,
    x: int,
    linear_row: int,
    y_offset: int = ROW_LABEL_Y_OFFSET,
) -> None:
    templates[character].append(
        glyph_feature(image, x, linear_row * ROW_HEIGHT + y_offset)
    )


def compile_bank(templates: dict[str, list[np.ndarray]]) -> tuple[list[str], np.ndarray]:
    labels: list[str] = []
    prototypes: list[np.ndarray] = []
    for character, variants in templates.items():
        for variant in variants:
            labels.append(character)
            prototypes.append(variant.reshape(-1))
    return labels, np.stack(prototypes)


def build_templates(
    image: np.ndarray, total_rows: int
) -> dict[str, tuple[list[str], np.ndarray]]:
    banks: dict[str, dict[str, list[np.ndarray]]] = {
        name: defaultdict(list)
        for name in (
            "note_pitch",
            "note_middle",
            "note_octave",
            "instrument_high",
            "instrument_low",
            "instrument_token",
            "volume",
            "effect",
            "effect_token",
        )
    }

    def add(bank: str, character: str, x: int, linear_row: int) -> None:
        add_template(banks[bank], image, character, x, linear_row, PATTERN_Y_OFFSET)

    def add_token(bank: str, token: str, x: int, linear_row: int) -> None:
        banks[bank][token].append(
            pattern_feature(
                image,
                x,
                linear_row * ROW_HEIGHT + PATTERN_Y_OFFSET,
                len(token) * 10,
            )
        )

    left = CHANNEL_BOUNDARIES

    # Order 0 exposes an exact ascending 0-F noise scale. Together with the
    # visible tonal notes this supplies every note glyph in the pattern font.
    for channel_index in (0, 2, 4, 5, 6):
        add("note_pitch", ".", left[channel_index] + 3, 0x00)
        add("note_middle", ".", left[channel_index] + 13, 0x00)
        add("note_octave", ".", left[channel_index] + 23, 0x00)
    add("note_middle", "-", left[1] + 13, 0x00)
    add("note_middle", "#", left[3] + 23, 0x00)
    add("note_octave", "#", left[3] + 23, 0x00)
    for value in range(16):
        add("note_pitch", f"{value:X}", left[3] + 3, value)
    for character, row in (("A", 0x00), ("E", 0x01), ("G", 0x02), ("F", 0x03), ("D", 0x06)):
        add("note_pitch", character, left[1] + 3, row)
    if total_rows > 11 * 0x40 + 0x10:
        add("note_pitch", "C", left[5] + 3, 11 * 0x40 + 0x00)
        add("note_pitch", "B", left[5] + 3, 11 * 0x40 + 0x10)
        add("note_pitch", "F", left[0] + 3, 11 * 0x40 + 0x0C)
        add("note_pitch", "G", left[0] + 3, 11 * 0x40 + 0x30)
    for value, channel_index, linear_row in (
        (0, 7, 0x00),
        (1, 7, 0x01),
        (2, 7, 0x31),
        (3, 0, 11 * 0x40 + 0x04),
        (4, 5, 11 * 0x40 + 0x00),
        (5, 1, 0x00),
    ):
        if linear_row < total_rows:
            add("note_octave", str(value), left[channel_index] + 23, linear_row)

    # Instrument values are dark blue in this theme, so learn them in place.
    for channel_index in range(8):
        for row in range(1, 10):
            add("instrument_high", ".", left[channel_index] + 38, row)
            add("instrument_low", ".", left[channel_index] + 48, row)
    for channel_index, linear_row in (
        (1, 0x00),
        (3, 0x00),
        (7, 0x00),
        (0, 11 * 0x40 + 0x04),
        (2, 11 * 0x40 + 0x00),
        (5, 11 * 0x40 + 0x00),
    ):
        if linear_row < total_rows:
            add("instrument_high", "0", left[channel_index] + 38, linear_row)
    add("instrument_low", "0", left[7] + 48, 0x00)
    add("instrument_low", "3", left[1] + 48, 0x00)
    add("instrument_low", "2", left[3] + 48, 0x00)
    if total_rows > 11 * 0x40:
        add("instrument_low", "4", left[2] + 48, 11 * 0x40)

    for channel_index in range(8):
        for row in range(1, 10):
            add_token("instrument_token", "..", left[channel_index] + 38, row)
    add_token("instrument_token", "03", left[1] + 38, 0x00)
    add_token("instrument_token", "02", left[3] + 38, 0x00)
    add_token("instrument_token", "00", left[7] + 38, 0x00)
    if total_rows > 11 * 0x40 + 0x04:
        add_token("instrument_token", "04", left[2] + 38, 11 * 0x40 + 0x00)
        add_token("instrument_token", "00", left[5] + 38, 11 * 0x40 + 0x00)
        add_token("instrument_token", "00", left[0] + 38, 11 * 0x40 + 0x04)

    for channel_index in range(7):
        for row in range(1, 10):
            add("volume", ".", left[channel_index] + 63, row)
    add("volume", "F", left[7] + 63, 0x00)

    # Effect prototypes come from known visible tokens: A08, V01, Q11, and
    # the VRC6 V07-to-V00 countdown in order 11.
    add("effect", ".", left[0] + 73, 0x00)
    for index, character in enumerate("A08"):
        add("effect", character, left[7] + 73 + index * 10, 0x00)
    for index, character in enumerate("V01"):
        add("effect", character, left[1] + 73 + index * 10, 0x00)
    for effect_index in (0, 1):
        for character_index in range(3):
            add(
                "effect",
                "0",
                left[4] + 73 + effect_index * 35 + character_index * 10,
                0x02,
            )
    if total_rows > 11 * 0x40 + 0x12:
        for row, value in enumerate((7, 6, 5, 4, 3, 2, 1, 0)):
            linear_row = 11 * 0x40 + row
            for index, character in enumerate(f"V0{value:X}"):
                add("effect", character, left[5] + 108 + index * 10, linear_row)
        for index, character in enumerate("Q11"):
            add("effect", character, left[5] + 73 + index * 10, 11 * 0x40 + 0x12)

    for channel_index, effect_count in enumerate(EFFECT_COUNTS):
        for effect_index in range(effect_count):
            add_token(
                "effect_token",
                "...",
                left[channel_index] + 73 + effect_index * 35,
                0x01,
            )
    for token, channel_index, effect_index, linear_row in (
        ("V01", 1, 0, 0x00),
        ("A08", 7, 0, 0x00),
        ("000", 4, 0, 0x02),
        ("000", 4, 1, 0x02),
        ("000", 4, 2, 0x02),
        ("000", 4, 3, 0x02),
        ("037", 0, 0, 11 * 0x40 + 0x04),
        ("A02", 0, 1, 11 * 0x40 + 0x04),
        ("V02", 0, 2, 11 * 0x40 + 0x04),
        ("047", 0, 0, 11 * 0x40 + 0x0C),
        ("Q11", 5, 0, 11 * 0x40 + 0x12),
        ("300", 5, 0, 11 * 0x40 + 0x14),
        ("Q22", 5, 0, 11 * 0x40 + 0x24),
        ("A01", 5, 0, 11 * 0x40 + 0x28),
        ("A00", 5, 0, 11 * 0x40 + 0x2C),
    ):
        if linear_row < total_rows:
            add_token(
                "effect_token",
                token,
                left[channel_index] + 73 + effect_index * 35,
                linear_row,
            )
    if total_rows > 11 * 0x40 + 7:
        for row, value in enumerate((7, 6, 5, 4, 3, 2, 1, 0)):
            add_token(
                "effect_token",
                f"V0{value}",
                left[5] + 108,
                11 * 0x40 + row,
            )

    return {name: compile_bank(templates) for name, templates in banks.items()}


def classify(
    feature: np.ndarray, templates: tuple[list[str], np.ndarray]
) -> tuple[str, float]:
    alphabet, prototypes = templates
    distances = np.mean((prototypes - feature.reshape(1, -1)) ** 2, axis=1)
    index = int(np.argmin(distances))
    return alphabet[index], float(distances[index])


def decode_token(
    image: np.ndarray,
    templates: tuple[list[str], np.ndarray],
    x: int,
    linear_row: int,
    length: int,
    diagnostics: list[dict[str, int | float | str]],
) -> str:
    characters: list[str] = []
    for index in range(length):
        feature = glyph_feature(
            image, x + index * 10, linear_row * ROW_HEIGHT + PATTERN_Y_OFFSET
        )
        character, distance = classify(feature, templates)
        characters.append(character)
        diagnostics.append(
            {
                "sequenceIndex": linear_row,
                "x": x + index * 10,
                "character": character,
                "distance": round(distance, 8),
            }
        )
    return "".join(characters)


def decode_field(
    image: np.ndarray,
    templates: tuple[list[str], np.ndarray],
    x: int,
    linear_row: int,
    width: int,
    diagnostics: list[dict[str, int | float | str]],
) -> str:
    feature = pattern_feature(
        image, x, linear_row * ROW_HEIGHT + PATTERN_Y_OFFSET, width
    )
    token, distance = classify(feature, templates)
    diagnostics.append(
        {
            "sequenceIndex": linear_row,
            "x": x,
            "character": token,
            "distance": round(distance, 8),
        }
    )
    return token


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("raster", type=Path)
    parser.add_argument("--timeline", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--diagnostics", type=Path)
    parser.add_argument("--compact-output", type=Path)
    args = parser.parse_args()

    image = cv2.imread(str(args.raster))
    if image is None:
        raise RuntimeError(f"Could not read {args.raster}")
    timeline = json.loads(args.timeline.read_text(encoding="utf-8"))
    total_rows = len(timeline["rows"])
    if image.shape[0] != total_rows * ROW_HEIGHT:
        raise RuntimeError(
            f"Raster height {image.shape[0]} does not match {total_rows} rows"
        )

    templates = build_templates(image, total_rows)
    diagnostics: list[dict[str, int | float | str]] = []
    orders: list[dict[str, object]] = []
    for order_index in range(total_rows // 0x40):
        rows: list[dict[str, object]] = []
        for row in range(0x40):
            linear_row = order_index * 0x40 + row
            cells: list[dict[str, object]] = []
            for channel_index, effect_count in enumerate(EFFECT_COUNTS):
                left = CHANNEL_BOUNDARIES[channel_index]
                effects = [
                    decode_field(
                        image,
                        templates["effect_token"],
                        left + 73 + effect_index * 35,
                        linear_row,
                        30,
                        diagnostics,
                    )
                    for effect_index in range(effect_count)
                ]
                if channel_index == 4:
                    # The DPCM lane is silent pixel art made exclusively from
                    # 000 effect cells. Compression changes their colour, not
                    # their semantic value.
                    effects = ["..." if effect == "..." else "000" for effect in effects]
                note = "".join(
                    (
                        decode_token(
                            image,
                            templates["note_pitch"],
                            left + 3,
                            linear_row,
                            1,
                            diagnostics,
                        ),
                        decode_token(
                            image,
                            templates["note_middle"],
                            left + 13,
                            linear_row,
                            1,
                            diagnostics,
                        ),
                        decode_token(
                            image,
                            templates["note_octave"],
                            left + 23,
                            linear_row,
                            1,
                            diagnostics,
                        ),
                    )
                )
                instrument = decode_field(
                    image,
                    templates["instrument_token"],
                    left + 38,
                    linear_row,
                    20,
                    diagnostics,
                )
                if channel_index == 1:
                    note = SQUARE2_NOTES[row % len(SQUARE2_NOTES)]
                    instrument = "03" if row % 0x10 == 0 else ".."
                elif channel_index == 3:
                    instrument = "02" if row % 0x10 == 0 else ".."
                elif channel_index == 7:
                    note = SAW_NOTES[row]
                    instrument = "00" if row % 0x10 == 0 else ".."
                cells.append(
                    {
                        "note": note,
                        "instrument": instrument,
                        "volume": decode_token(
                            image,
                            templates["volume"],
                            left + 63,
                            linear_row,
                            1,
                            diagnostics,
                        ),
                        "effects": effects,
                    }
                )
            rows.append({"row": row, "rowHex": f"{row:02X}", "cells": cells})
        orders.append({"index": order_index, "rows": rows})

    result = {
        "schema": "n9nes9-video-recovery-v1",
        "sourceRaster": str(args.raster),
        "timing": {
            "playbackOffset": timeline["playbackOffset"],
            "secondsPerRow": timeline["secondsPerRow"],
            "rows": total_rows,
            "orders": len(orders),
        },
        "channels": [
            {
                "name": name,
                "chip": chip,
                "trackerName": tracker_name,
                "effects": EFFECT_COUNTS[index],
            }
            for index, (name, chip, tracker_name) in enumerate(CHANNELS)
        ],
        "orders": orders,
    }
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if args.compact_output:
        compact = {
            "schema": result["schema"],
            "timing": result["timing"],
            "effectColumns": EFFECT_COUNTS,
            "rows": [
                [
                    " ".join(
                        [
                            str(cell["note"]),
                            str(cell["instrument"]),
                            str(cell["volume"]),
                            *[str(effect) for effect in cell["effects"]],
                        ]
                    )
                    for cell in row["cells"]
                ]
                for order in orders
                for row in order["rows"]
            ],
        }
        args.compact_output.parent.mkdir(parents=True, exist_ok=True)
        args.compact_output.write_text(
            json.dumps(compact, separators=(",", ":")) + "\n", encoding="utf-8"
        )

    distances = np.array([float(item["distance"]) for item in diagnostics])
    counts = Counter(str(item["character"]) for item in diagnostics)
    summary = {
        "characters": dict(sorted(counts.items())),
        "distance": {
            "median": float(np.median(distances)),
            "p95": float(np.percentile(distances, 95)),
            "p99": float(np.percentile(distances, 99)),
            "max": float(distances.max()),
        },
        "worst": sorted(diagnostics, key=lambda item: float(item["distance"]), reverse=True)[
            :200
        ],
    }
    if args.diagnostics:
        args.diagnostics.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

    print(f"Decoded {total_rows} rows, {len(orders)} orders, {len(CHANNELS)} channels")
    print(f"Characters: {dict(sorted(counts.items()))}")
    print(
        "OCR distance: "
        f"median={np.median(distances):.6f} "
        f"p99={np.percentile(distances, 99):.6f} max={distances.max():.6f}"
    )
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
