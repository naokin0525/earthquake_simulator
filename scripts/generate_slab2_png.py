#!/usr/bin/env python3
"""Encode paired USGS Slab2 XYZ grids as compact, lossless RGBA PNG rasters."""

import json
import math
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data_references" / "slab2"
OUTPUT = ROOT / "public" / "data" / "slab2"
GRID_STEP_DEGREES = 0.05
TARGET_SCALE = 100
REGIONS = [
    ("kur", "Pacific plate - Kuril/Japan", "kur_slab2_dep_02.24.18.xyz", "kur_slab2_thk_02.24.18.xyz"),
    ("izu", "Pacific plate - Izu-Bonin", "izu_slab2_dep_02.24.18.xyz", "izu_slab2_thk_02.24.18.xyz"),
    ("ryu", "Philippine Sea plate - Ryukyu/Nankai", "ryu_slab2_dep_02.26.18.xyz", "ryu_slab2_thk_02.26.18.xyz"),
]


def read_xyz(path: Path) -> dict[tuple[float, float], float | None]:
    values = {}
    with path.open(encoding="ascii") as source:
        for line in source:
            lon_text, lat_text, value_text = line.strip().split(",")
            value = None if value_text == "NaN" else float(value_text)
            values[(float(lon_text), float(lat_text))] = value
    return values


def png_chunk(kind: bytes, data: bytes) -> bytes:
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def write_png(path: Path, width: int, height: int, scanlines: bytes) -> None:
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(scanlines, level=9))
        + png_chunk(b"IEND", b"")
    )


def encode_region(region: tuple[str, str, str, str]) -> dict:
    region_id, label, depth_name, thickness_name = region
    depths = read_xyz(SOURCE / depth_name)
    thicknesses = read_xyz(SOURCE / thickness_name)
    if depths.keys() != thicknesses.keys():
        raise ValueError(f"{region_id}: depth and thickness coordinates do not match")

    lons = sorted({coord[0] for coord in depths})
    lats = sorted({coord[1] for coord in depths})
    width, height = len(lons), len(lats)
    if not math.isclose(lons[1] - lons[0], GRID_STEP_DEGREES) or not math.isclose(
        lats[1] - lats[0], GRID_STEP_DEGREES
    ):
        raise ValueError(f"{region_id}: unexpected grid interval")

    depth_rows = []
    thickness_rows = []
    valid_cells = 0
    valid_depths = [abs(value) for value in depths.values() if value is not None]
    valid_thicknesses = [value for value in thicknesses.values() if value is not None]
    depth_offset = min(valid_depths)
    thickness_offset = min(valid_thicknesses)
    depth_scale = min(
        TARGET_SCALE,
        math.floor(65534 / max(1e-9, max(valid_depths) - depth_offset)),
    )
    thickness_scale = min(
        TARGET_SCALE,
        math.floor(65534 / max(1e-9, max(valid_thicknesses) - thickness_offset)),
    )

    for lat in reversed(lats):
        depth_row = bytearray([0])
        thickness_row = bytearray([0])
        for lon in lons:
            depth = depths[(lon, lat)]
            thickness = thicknesses[(lon, lat)]
            if depth is None or thickness is None:
                depth_row.extend((0, 0, 0, 255))
                thickness_row.extend((0, 0, 0, 255))
                continue

            depth_value = round((abs(depth) - depth_offset) * depth_scale) + 1
            thickness_value = round((thickness - thickness_offset) * thickness_scale) + 1
            if not (0 < depth_value <= 65535 and 0 < thickness_value <= 65535):
                raise ValueError(f"{region_id}: value outside PNG encoding range at {lon}, {lat}")
            depth_row.extend(((depth_value >> 8) & 0xFF, depth_value & 0xFF, 0, 255))
            thickness_row.extend(((thickness_value >> 8) & 0xFF, thickness_value & 0xFF, 0, 255))
            valid_cells += 1
        depth_rows.append(depth_row)
        thickness_rows.append(thickness_row)

    OUTPUT.mkdir(parents=True, exist_ok=True)
    depth_filename = f"{region_id}_dep.png"
    thickness_filename = f"{region_id}_thk.png"
    write_png(OUTPUT / depth_filename, width, height, b"".join(depth_rows))
    write_png(OUTPUT / thickness_filename, width, height, b"".join(thickness_rows))
    return {
        "id": region_id,
        "label": label,
        "depthImage": f"/data/slab2/{depth_filename}",
        "thicknessImage": f"/data/slab2/{thickness_filename}",
        "minLon": lons[0],
        "maxLon": lons[-1],
        "minLat": lats[0],
        "maxLat": lats[-1],
        "width": width,
        "height": height,
        "gridStepDegrees": GRID_STEP_DEGREES,
        "depthOffsetKm": depth_offset,
        "depthScale": depth_scale,
        "thicknessOffsetKm": thickness_offset,
        "thicknessScale": thickness_scale,
        "validCells": valid_cells,
    }


def main() -> None:
    manifest = {
        "encoding": "Two opaque RGBA8 images per region; R/G=16-bit depth or thickness code; zero=NoData",
        "regions": [],
    }
    for region in REGIONS:
        metadata = encode_region(region)
        manifest["regions"].append(metadata)
        print(
            f"{metadata['id']}: {metadata['validCells']} valid cells -> "
            f"{metadata['depthImage']}, {metadata['thicknessImage']}"
        )

    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
