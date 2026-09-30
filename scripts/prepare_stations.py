#!/usr/bin/env python3
"""
scripts/prepare_stations.py
===========================
Preprocesses seismograph station records across Japan for real-time EEW simulation.

Input:
  - input_data/stations.csv (or data_references/stationlist_all.csv)

Outputs (written to ./public/data/stations/):
  - stations.bin  : Compact little-endian raw binary file with fixed 16-byte record layout.
                    Header: uint32 (4 bytes) -> Total station count N.
                    Records: N * 16 bytes:
                      - lat        : float32 (4 bytes)
                      - lon        : float32 (4 bytes)
                      - amp_factor : float32 (4 bytes)
                      - pref_code  : uint8   (1 byte)
                      - reserved   : uint8[3](3 bytes padding)
  - stations_meta.json : Array of station metadata objects indexed matching stations.bin.
"""

import os
import sys
import json
import struct
import argparse
import pandas as pd
import numpy as np

# Map of Japanese Prefecture names (Kanji & Kanji without suffix) to 1-based JIS prefecture code (1 to 47)
PREFECTURE_CODES = {
    "北海道": 1, "青森": 2, "青森県": 2, "岩手": 3, "岩手県": 3, "宮城": 4, "宮城県": 4,
    "秋田": 5, "秋田県": 5, "山形": 6, "山形県": 6, "福島": 7, "福島県": 7, "茨城": 8, "茨城県": 8,
    "栃木": 9, "栃木県": 9, "群馬": 10, "群馬県": 10, "埼玉": 11, "埼玉県": 11, "千葉": 12, "千葉県": 12,
    "東京": 13, "東京都": 13, "神奈川": 14, "神奈川県": 14, "新潟": 15, "新潟県": 15, "富山": 16, "富山県": 16,
    "石川": 17, "石川県": 17, "福井": 18, "福井県": 18, "山梨": 19, "山梨県": 19, "長野": 20, "長野県": 20,
    "岐阜": 21, "岐阜県": 21, "静岡": 22, "静岡県": 22, "愛知": 23, "愛知県": 23, "三重": 24, "三重県": 24,
    "滋賀": 25, "滋賀県": 25, "京都": 26, "京都府": 26, "大阪": 27, "大阪府": 27, "兵庫": 28, "兵庫県": 28,
    "奈良": 29, "奈良県": 29, "和歌山": 30, "和歌山県": 30, "鳥取": 31, "鳥取県": 31, "島根": 32, "島根県": 32,
    "岡山": 33, "岡山県": 33, "広島": 34, "広島県": 34, "山口": 35, "山口県": 35, "徳島": 36, "徳島県": 36,
    "香川": 37, "香川県": 37, "愛媛": 38, "愛媛県": 38, "高知": 39, "高知県": 39, "福岡": 40, "福岡県": 40,
    "佐賀": 41, "佐賀県": 41, "長崎": 42, "長崎県": 42, "熊本": 43, "熊本県": 43, "大分": 44, "大分県": 44,
    "宮崎": 45, "宮崎県": 45, "鹿児島": 46, "鹿児島県": 46, "沖縄": 47, "沖縄県": 47
}

# Japan spatial boundary bounding box (WGS84)
LAT_MIN, LAT_MAX = 20.0, 46.0
LON_MIN, LON_MAX = 122.0, 154.0

def find_column(df, candidates, default=None):
    """Finds matching column name from candidates (case-insensitive)."""
    cols_lower = {str(c).strip().lower(): c for c in df.columns}
    for cand in candidates:
        if cand.lower() in cols_lower:
            return cols_lower[cand.lower()]
    return default

def parse_pref_code(val):
    """Parses prefecture value into uint8 pref_code (1-47, default 0 if unknown)."""
    if pd.isna(val):
        return 0
    try:
        code = int(val)
        if 1 <= code <= 47:
            return code
    except (ValueError, TypeError):
        pass
    
    val_str = str(val).strip()
    return PREFECTURE_CODES.get(val_str, 0)

def read_csv_robust(input_csv: str) -> pd.DataFrame:
    """Reads CSV file handling various encodings and trailing commas gracefully."""
    encodings = ['utf-8-sig', 'utf-8', 'cp932', 'shift_jis']
    for enc in encodings:
        try:
            with open(input_csv, 'r', encoding=enc) as f:
                header_line = f.readline().strip()
                data_line = f.readline().strip()
            
            header_cols = [c.strip() for c in header_line.split(',') if c.strip() != '']
            data_fields = [c.strip() for c in data_line.split(',')]
            
            if len(data_fields) > len(header_cols):
                extra_count = len(data_fields) - len(header_cols)
                names = header_cols + [f"unnamed_{i}" for i in range(extra_count)]
                df = pd.read_csv(input_csv, encoding=enc, names=names, skiprows=1)
            else:
                df = pd.read_csv(input_csv, encoding=enc)
            
            # Check if lat column exists and is numeric
            col_lat = find_column(df, ["lat", "latitude"])
            if col_lat:
                pd.to_numeric(df[col_lat].dropna().iloc[0])
                return df
        except Exception:
            continue

    return pd.read_csv(input_csv)

def process_stations(input_csv: str, output_dir: str):
    """Reads stations CSV, validates, packs binary buffer and writes JSON metadata."""
    if not os.path.exists(input_csv):
        print(f"[ERROR] Input file not found: {input_csv}", file=sys.stderr)
        sys.exit(1)

    print(f"[INFO] Reading stations from: {input_csv}")
    df = read_csv_robust(input_csv)

    # Detect columns
    col_id = find_column(df, ["station_id", "id", "romaji", "code"])
    col_name = find_column(df, ["name", "station_name", "kanji"])
    col_lat = find_column(df, ["lat", "latitude"])
    col_lon = find_column(df, ["lon", "longtitude", "longitude"])
    col_amp = find_column(df, ["amp_factor", "arv", "amp"])
    col_pref = find_column(df, ["pref_code", "prefecture", "pref"])

    if not col_lat or not col_lon:
        print("[ERROR] CSV must contain latitude and longitude columns!", file=sys.stderr)
        sys.exit(1)

    # Ensure numeric lat/lon
    df[col_lat] = pd.to_numeric(df[col_lat], errors='coerce')
    df[col_lon] = pd.to_numeric(df[col_lon], errors='coerce')

    # Filter by Japan bounding box and drop invalid lat/lon
    valid_mask = (
        df[col_lat].notna() & df[col_lon].notna() &
        (df[col_lat] >= LAT_MIN) & (df[col_lat] <= LAT_MAX) &
        (df[col_lon] >= LON_MIN) & (df[col_lon] <= LON_MAX)
    )
    df_clean = df[valid_mask].copy()

    total_records = len(df_clean)
    print(f"[INFO] Total valid stations in Japan bounds: {total_records} / {len(df)}")

    os.makedirs(output_dir, exist_ok=True)
    bin_path = os.path.join(output_dir, "stations.bin")
    json_path = os.path.join(output_dir, "stations_meta.json")

    metadata = []

    # Prepare binary packing
    # Little-endian layout:
    # Header: uint32 total_stations
    # Per record: float32 lat, float32 lon, float32 amp_factor, uint8 pref_code, uint8[3] padding
    struct_fmt = "<fffB3x"  # 4 + 4 + 4 + 1 + 3 = 16 bytes

    with open(bin_path, "wb") as f_bin:
        # Write uint32 header
        f_bin.write(struct.pack("<I", total_records))

        for idx, row in df_clean.reset_index(drop=True).iterrows():
            lat = float(row[col_lat])
            lon = float(row[col_lon])
            
            # Amp factor
            amp_val = row[col_amp] if col_amp else 1.0
            try:
                amp_factor = float(amp_val) if pd.notna(amp_val) else 1.0
            except (ValueError, TypeError):
                amp_factor = 1.0

            # Pref code
            pref_val = row[col_pref] if col_pref else 0
            pref_code = parse_pref_code(pref_val)

            # Pack binary record (16 bytes)
            packed_record = struct.pack(struct_fmt, lat, lon, amp_factor, pref_code)
            f_bin.write(packed_record)

            # Metadata entry
            st_id = str(row[col_id]) if col_id and pd.notna(row[col_id]) else f"ST_{idx:04d}"
            st_name = str(row[col_name]) if col_name and pd.notna(row[col_name]) else st_id

            metadata.append({
                "index": idx,
                "station_id": st_id,
                "name": st_name,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "amp_factor": round(amp_factor, 3),
                "pref_code": pref_code
            })

    with open(json_path, "w", encoding="utf-8") as f_json:
        json.dump(metadata, f_json, ensure_ascii=False, indent=2)

    bin_size = os.path.getsize(bin_path)
    print(f"[SUCCESS] Written {bin_path} ({bin_size} bytes, expected header + {total_records} * 16 = {4 + total_records * 16} bytes)")
    print(f"[SUCCESS] Written {json_path} ({len(metadata)} metadata entries)")

def main():
    parser = argparse.ArgumentParser(description="Preprocess seismograph stations into binary & metadata formats.")
    parser.add_argument("--input", "-i", type=str, default="input_data/stations.csv", help="Path to stations CSV file.")
    parser.add_argument("--output", "-o", type=str, default="public/data/stations", help="Output directory path.")
    args = parser.parse_args()

    # Fallback to data_references/stationlist_all.csv if default input_data path doesn't exist
    input_file = args.input
    if input_file == "input_data/stations.csv" and not os.path.exists(input_file):
        alt_path = os.path.join("data_references", "stationlist_all.csv")
        if os.path.exists(alt_path):
            print(f"[INFO] '{input_file}' not found. Using fallback reference dataset: '{alt_path}'")
            input_file = alt_path

    process_stations(input_file, args.output)

if __name__ == "__main__":
    main()
