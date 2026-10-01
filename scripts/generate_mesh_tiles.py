#!/usr/bin/env python3
"""
scripts/generate_mesh_tiles.py
==============================
Rasterizes J-SHIS 250m mesh amplification factor (ARV) data into Web Mercator (EPSG:3857)
master GeoTIFF and slices it into standard XYZ raster tile pyramids (Z=5 to Z=10).

# RGB Encoding Scheme:
#   - R Channel (uint8, 0-255): Encodes Surface Amplification Factor (ARV).
#       Mapping formula: R_val = clamp(floor((ARV - 0.5) / (3.0 - 0.5) * 255.0), 0, 255)
#       ARV range [0.5, 3.0] maps linearly to [0, 255].
#   - G Channel (uint8, 0-255): Encodes Average Shear Wave Velocity in upper 30m (AVS).
#       Mapping formula: G_val = clamp(floor((AVS - 100.0) / (1000.0 - 100.0) * 255.0), 0, 255)
#       AVS range [100.0, 1000.0] maps linearly to [0, 255].
#   - B Channel (uint8, 0-255): Reserved for future use or other geological indicators (default 0).
#   - Alpha Channel (uint8, 0-255): 255 for land/mesh data pixels, 0 for ocean/nodata pixels.
#
# Note: Data based on Z-RULES (J-SHIS 250m mesh).
# Columns: CODE (Mesh Code), JCODE (Prefectural Code), AVS (Vs30), ARV (Amp Factor)


GLSL Shader Inverse Decompression Formula:
===========================================
```glsl
// Unpack ARV amplification factor from R channel in GLSL fragment shader
uniform sampler2D u_meshTile;
varying vec2 v_uv;

void main() {
    vec4 color = texture2D(u_meshTile, v_uv);
    if (color.a > 0.0) {
        // Reverse mapping: R_val = (ARV - 0.5) / 2.5 * 255.0
        float arv = 0.5 + (color.r * (2.5 / 255.0));
        // Apply ARV for ground motion amplification (PGA / PGV calculation)
    }
}
```

Input:
  - input_data/jshis_mesh_250m.csv (or data_references/Z-V4-JAPAN-AMP-VS400_M250.csv)

Outputs:
  - public/tiles/mesh/{z}/{x}/{y}.png  (Zoom levels Z=5 to Z=10)
"""

import os
import sys
import math
import argparse
import numpy as np
import pandas as pd
from PIL import Image

try:
    import rasterio
    from rasterio.transform import from_bounds
    from rasterio.enums import Resampling
    from rasterio.warp import reproject, calculate_default_transform
    HAS_RASTERIO = True
except ImportError:
    HAS_RASTERIO = False

# EPSG:3857 (Web Mercator) constants
EARTH_RADIUS = 6378137.0
ORIGIN_SHIFT = 2 * math.pi * EARTH_RADIUS / 2.0  # ~20037508.342789244

def lon_to_mercator_x(lon):
    return lon * ORIGIN_SHIFT / 180.0

def lat_to_mercator_y(lat):
    lat = np.clip(lat, -89.9, 89.9)
    return np.log(np.tan((90.0 + lat) * np.pi / 360.0)) * ORIGIN_SHIFT / np.pi

def mercator_x_to_lon(x):
    return (x / ORIGIN_SHIFT) * 180.0

def mercator_y_to_lat(y):
    return (np.arctan(np.exp(y * np.pi / ORIGIN_SHIFT)) * 360.0 / np.pi) - 90.0

def decode_jis_mesh_codes(mesh_codes, arv_values, plate_values=None, sediment_values=None):
    """
    Decodes 10-digit JIS 250m mesh codes or 8-digit 1km mesh codes into lat/lon centroids.
    Vectorized NumPy implementation for maximum processing speed.
    """
    codes = np.asarray(mesh_codes, dtype=np.int64)
    arv = np.asarray(arv_values, dtype=np.float32)

    # Detect 10-digit vs 8-digit
    is_10digit = (codes >= 1000000000)

    # 10-digit 250m mesh decoding
    p1p2 = codes // 100000000
    q1q2 = (codes // 1000000) % 100
    r = (codes // 100000) % 10
    s = (codes // 10000) % 10
    t = (codes // 1000) % 10
    u = (codes // 100) % 10
    v = (codes // 10) % 10
    w = codes % 10

    lat_base = p1p2 / 1.5
    lon_base = q1q2 + 100.0
    lat_2nd = r * (5.0 / 60.0)
    lon_2nd = s * (7.5 / 60.0)
    lat_3rd = t * (30.0 / 3600.0)
    lon_3rd = u * (45.0 / 3600.0)

    # 500m offsets (v: 1-4)
    v_lat_off = np.where((v == 3) | (v == 4), 15.0 / 3600.0, 0.0)
    v_lon_off = np.where((v == 2) | (v == 4), 22.5 / 3600.0, 0.0)

    # 250m offsets (w: 1-4)
    w_lat_off = np.where((w == 3) | (w == 4), 7.5 / 3600.0, 0.0)
    w_lon_off = np.where((w == 2) | (w == 4), 11.25 / 3600.0, 0.0)

    lat_min = lat_base + lat_2nd + lat_3rd + np.where(is_10digit, v_lat_off + w_lat_off, 0.0)
    lon_min = lon_base + lon_2nd + lon_3rd + np.where(is_10digit, v_lon_off + w_lon_off, 0.0)

    # Centroid
    lat_center = lat_min + np.where(is_10digit, 3.75 / 3600.0, 15.0 / 3600.0)
    lon_center = lon_min + np.where(is_10digit, 5.625 / 3600.0, 22.5 / 3600.0)

    return lat_center, lon_center, arv

def encode_avs_to_g(avs):
    """Encodes AVS [100.0, 1000.0] to uint8 [0, 255]."""
    norm = np.clip((avs - 100.0) / 900.0, 0.0, 1.0)
    return np.floor(norm * 255.0).astype(np.uint8)

def encode_arv_to_r(arv):
    """Encodes ARV factor [0.5, 3.0] to uint8 [0, 255]."""
    norm = np.clip((arv - 0.5) / 2.5, 0.0, 1.0)
    return np.floor(norm * 255.0).astype(np.uint8)

def latlon_to_tile(lat, lon, zoom):
    lat_rad = math.radians(lat)
    n = 2.0 ** zoom
    xtile = int((lon + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile

def tile_to_bounds_mercator(xtile, ytile, zoom):
    n = 2.0 ** zoom
    tile_size = (2 * ORIGIN_SHIFT) / n
    xmin = -ORIGIN_SHIFT + xtile * tile_size
    xmax = xmin + tile_size
    ymax = ORIGIN_SHIFT - ytile * tile_size
    ymin = ymax - tile_size
    return xmin, ymin, xmax, ymax

def generate_tiles_fast(lat, lon, r_channel, g_channel, b_channel, min_zoom=5, max_zoom=10, output_dir="public/tiles/mesh"):
    """
    Renders RGB tile pyramid across zoom levels using fast grid aggregation.
    """
    x_merc = lon_to_mercator_x(lon)
    y_merc = lat_to_mercator_y(lat)

    os.makedirs(output_dir, exist_ok=True)

    for zoom in range(min_zoom, max_zoom + 1):
        print(f"[INFO] Generating tiles for Zoom Level Z={zoom}...")
        n = 2 ** zoom
        tile_size_merc = (2 * ORIGIN_SHIFT) / n

        # Determine tile range covering data
        min_x_merc, max_x_merc = np.min(x_merc), np.max(x_merc)
        min_y_merc, max_y_merc = np.min(y_merc), np.max(y_merc)

        min_xtile = int(np.floor((min_x_merc + ORIGIN_SHIFT) / tile_size_merc))
        max_xtile = int(np.floor((max_x_merc + ORIGIN_SHIFT) / tile_size_merc))

        min_ytile = int(np.floor((ORIGIN_SHIFT - max_y_merc) / tile_size_merc))
        max_ytile = int(np.floor((ORIGIN_SHIFT - min_y_merc) / tile_size_merc))

        total_tiles = (max_xtile - min_xtile + 1) * (max_ytile - min_ytile + 1)
        print(f"  Zoom {zoom}: rendering tile bbox X:[{min_xtile}..{max_xtile}], Y:[{min_ytile}..{max_ytile}] ({total_tiles} tiles)")

        tile_pixel_res = 256

        # Bin points to current zoom tile coordinates
        tile_x_indices = np.floor((x_merc + ORIGIN_SHIFT) / tile_size_merc).astype(int)
        tile_y_indices = np.floor((ORIGIN_SHIFT - y_merc) / tile_size_merc).astype(int)

        # Process tile by tile
        for xtile in range(min_xtile, max_xtile + 1):
            x_mask = (tile_x_indices == xtile)
            if not np.any(x_mask):
                continue

            for ytile in range(min_ytile, max_ytile + 1):
                mask = x_mask & (tile_y_indices == ytile)
                if not np.any(mask):
                    continue

                xmin, ymin, xmax, ymax = tile_to_bounds_mercator(xtile, ytile, zoom)

                # Relative position inside 256x256 tile canvas
                px = np.clip(np.floor((x_merc[mask] - xmin) / (xmax - xmin) * tile_pixel_res).astype(int), 0, 255)
                py = np.clip(np.floor((ymax - y_merc[mask]) / (ymax - ymin) * tile_pixel_res).astype(int), 0, 255)

                # Create RGBA tile buffer
                rgba_tile = np.zeros((tile_pixel_res, tile_pixel_res, 4), dtype=np.uint8)

                # Use mesh-aware filling to avoid gaps between cells (rasterize as blocks)
                HALF_LAT = (7.5 / 3600.0) / 2.0
                HALF_LON = (11.25 / 3600.0) / 2.0

                m_lat_min = lat[mask] - HALF_LAT
                m_lat_max = lat[mask] + HALF_LAT
                m_lon_min = lon[mask] - HALF_LON
                m_lon_max = lon[mask] + HALF_LON

                # Convert bounds to Mercator
                m_xmin = lon_to_mercator_x(m_lon_min)
                m_xmax = lon_to_mercator_x(m_lon_max)
                m_ymin = lat_to_mercator_y(m_lat_min)
                m_ymax = lat_to_mercator_y(m_lat_max)

                # Calculate pixel boundaries within the 256x256 tile
                px0 = np.clip(np.floor((m_xmin - xmin) / (xmax - xmin) * tile_pixel_res).astype(int), 0, 255)
                px1 = np.clip(np.ceil((m_xmax - xmin) / (xmax - xmin) * tile_pixel_res).astype(int), 0, 255)
                py0 = np.clip(np.floor((ymax - m_ymax) / (ymax - ymin) * tile_pixel_res).astype(int), 0, 255)
                py1 = np.clip(np.ceil((ymax - m_ymin) / (ymax - ymin) * tile_pixel_res).astype(int), 0, 255)

                r_sub = r_channel[mask]
                g_sub = g_channel[mask]
                b_sub = b_channel[mask]

                for i in range(len(r_sub)):
                    rgba_tile[py0[i]:py1[i] + 1, px0[i]:px1[i] + 1, 0] = r_sub[i]
                    rgba_tile[py0[i]:py1[i] + 1, px0[i]:px1[i] + 1, 1] = g_sub[i]
                    rgba_tile[py0[i]:py1[i] + 1, px0[i]:px1[i] + 1, 2] = b_sub[i]
                    rgba_tile[py0[i]:py1[i] + 1, px0[i]:px1[i] + 1, 3] = 255

                # Save PNG
                z_dir = os.path.join(output_dir, str(zoom), str(xtile))
                os.makedirs(z_dir, exist_ok=True)
                tile_path = os.path.join(z_dir, f"{ytile}.png")

                img = Image.fromarray(rgba_tile, mode="RGBA")
                img.save(tile_path, "PNG", compress_level=6)

    print(f"[SUCCESS] Tile pyramid generation complete in {output_dir}")

def read_mesh_csv_robust(input_csv: str) -> pd.DataFrame:
    """Reads mesh CSV file, extracting headers even if prefixed with comment character '#'."""
    header_cols = None
    encodings = ['utf-8-sig', 'utf-8', 'cp932', 'shift_jis']
    
    for enc in encodings:
        try:
            with open(input_csv, 'r', encoding=enc, errors='ignore') as f:
                for _ in range(50):
                    line = f.readline()
                    if not line:
                        break
                    stripped = line.strip()
                    if stripped.startswith('#') and 'CODE' in stripped.upper():
                        header_cols = [c.strip().upper() for c in stripped.lstrip('#').split(',') if c.strip()]
                        break
            if header_cols:
                df = pd.read_csv(input_csv, comment='#', names=header_cols, encoding=enc, skipinitialspace=True)
                return df
        except Exception:
            continue

    # Fallback to standard read_csv
    df = pd.read_csv(input_csv, comment='#', skipinitialspace=True)
    df.columns = [c.strip().upper() for c in df.columns]
    return df

def process_mesh_csv(input_csv: str, output_dir: str, min_zoom: int, max_zoom: int):
    """Loads mesh data CSV, converts to Mercator grid, encodes RGBA channels, and generates tiles."""
    if not os.path.exists(input_csv):
        print(f"[ERROR] Input file not found: {input_csv}", file=sys.stderr)
        sys.exit(1)

    print(f"[INFO] Loading 250m Mesh data from: {input_csv}")
    
    df = read_mesh_csv_robust(input_csv)

    print(f"[INFO] Dataset loaded. Total rows: {len(df)}")
    print(f"[INFO] Columns detected: {list(df.columns)}")

    # Check for mesh code vs lat/lon columns
    col_code = next((c for c in df.columns if c in ["CODE", "MESH_CODE", "MESHCODE"]), None)
    col_lat = next((c for c in df.columns if c in ["LAT", "LATITUDE"]), None)
    col_lon = next((c for c in df.columns if c in ["LON", "LONGTITUDE", "LONGITUDE"]), None)
    col_arv = next((c for c in df.columns if c in ["ARV", "AMP_FACTOR", "AMP"]), None)
    col_avs = next((c for c in df.columns if c in ["AVS", "VS30"]), None)
    col_g = next((c for c in df.columns if c in ["PLATE_DEPTH", "SLAB", "G"]), None)
    col_b = next((c for c in df.columns if c in ["SEDIMENT", "ELEVATION", "B"]), None)

    if col_arv is None:
        print("[ERROR] ARV column not found in dataset!", file=sys.stderr)
        sys.exit(1)

    # Filter non-zero ARV records
    df[col_arv] = pd.to_numeric(df[col_arv], errors='coerce').fillna(0.0)
    df_valid = df[df[col_arv] > 0.0].copy()

    print(f"[INFO] Valid land mesh records with ARV > 0: {len(df_valid)}")

    if col_lat and col_lon:
        lat = df_valid[col_lat].astype(np.float32).values
        lon = df_valid[col_lon].astype(np.float32).values
        arv = df_valid[col_arv].astype(np.float32).values
    elif col_code:
        print("[INFO] Decoding JIS Mesh Codes into lat/lon centroids...")
        codes = df_valid[col_code].values
        arv_vals = df_valid[col_arv].values
        lat, lon, arv = decode_jis_mesh_codes(codes, arv_vals)
    else:
        print("[ERROR] CSV must contain either (lat, lon) or JIS mesh code column!", file=sys.stderr)
        sys.exit(1)

    # Encode R channel (ARV factor)
    r_channel = encode_arv_to_r(arv)

    # Encode G channel (AVS value)
    if col_avs is not None:
        avs_vals = df_valid[col_avs].astype(np.float32).values
        g_channel = encode_avs_to_g(avs_vals)
    else:
        g_channel = np.zeros_like(r_channel)

    # Encode B channel (unused/reserved)
    b_channel = np.zeros_like(r_channel)

    print("[INFO] Starting fast raster tile pyramid generation...")
    generate_tiles_fast(lat, lon, r_channel, g_channel, b_channel, min_zoom=min_zoom, max_zoom=max_zoom, output_dir=output_dir)

def main():
    parser = argparse.ArgumentParser(description="Rasterize 250m J-SHIS mesh dataset into RGB encoded XYZ tile pyramid.")
    parser.add_argument("--input", "-i", type=str, default="input_data/jshis_mesh_250m.csv", help="Input mesh CSV file path.")
    parser.add_argument("--output", "-o", type=str, default="public/tiles/mesh", help="Output directory for XYZ tile pyramid.")
    parser.add_argument("--min-zoom", type=int, default=5, help="Minimum zoom level (default: 5).")
    parser.add_argument("--max-zoom", type=int, default=10, help="Maximum zoom level (default: 10).")
    args = parser.parse_args()

    input_file = args.input
    if input_file == "input_data/jshis_mesh_250m.csv" and not os.path.exists(input_file):
        alt_path = os.path.join("data_references", "Z-V4-JAPAN-AMP-VS400_M250.csv")
        if os.path.exists(alt_path):
            print(f"[INFO] '{input_file}' not found. Using fallback reference dataset: '{alt_path}'")
            input_file = alt_path

    process_mesh_csv(input_file, args.output, args.min_zoom, args.max_zoom)

if __name__ == "__main__":
    main()
