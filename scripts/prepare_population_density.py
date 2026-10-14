# -*- coding: utf-8 -*-
"""
prepare_population_density.py
=============================
e-Stat 統計地理情報システムから国勢調査 500m メッシュ人口データ
（第4次地域メッシュ / 9桁コード、例: station_noise/raw/T001101_3622/tblT001101H3622.txt）
を取得・読み込み、各観測点（K-NET / KiK-net / JMA 観測点）の周辺人口密度を計算して
震度計ノイズシミュレーション用の密度テーブル (CSV / .npz) を生成する。

使い方:
    python scripts/prepare_population_density.py
    python scripts/prepare_population_density.py --mesh-dir station_noise/raw --stations public/data/stations/stations_meta.json

データ出典:
    政府統計の総合窓口(e-Stat) 統計地理情報システム
    「令和2年国勢調査 その１ 人口等基本集計 500mメッシュ (T001101)」
    https://www.e-stat.go.jp/gis/statmap-search?page=1&type=1&toukeiCode=00200521
"""

import argparse
import io
import os
import re
import zipfile

import numpy as np
import pandas as pd
import requests
from bs4 import BeautifulSoup

BASE = "https://www.e-stat.go.jp"

# 令和2年国勢調査・500mメッシュ統計データのダウンロード一覧ページ
SURVEY_PAGE = (
    f"{BASE}/gis/statmap-search?page=1&type=2&toukeiCode=00200521"
    "&toukeiYear=2020&serveyId=A002005212020&datum=2000"
)

HEADERS = {"User-Agent": "earthquake_simulator/1.0 (data preparation)"}
CELL_AREA_KM2 = 0.25  # 500m メッシュ = 0.25 km^2

# 人口列の正規表現 (例: T001101001, T000596001 等)
POP_COL_RE = re.compile(r"^(T001101001|T000[0-9]+|T[0-9]{7,})$", re.I)


# ----------------------------------------------------------------------------
# 1) e-Stat からメッシュ統計 CSV (zip) を取得
# ----------------------------------------------------------------------------
def discover_mesh_zip_links(session: requests.Session) -> list[str]:
    """統計GISのダウンロード一覧ページから 500m メッシュ zip の URL を抽出する。"""
    res = session.get(SURVEY_PAGE, headers=HEADERS, timeout=60)
    res.raise_for_status()
    soup = BeautifulSoup(res.text, "html.parser")

    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "downloadfile" in href or href.lower().endswith(".zip"):
            url = href if href.startswith("http") else BASE + href
            links.append(url)
    return sorted(set(links))


def download_mesh_csvs(session: requests.Session, links: list[str], out_dir: str) -> list[str]:
    """zip をダウンロードし、各 zip 名ごとのフォルダに展開して TXT/CSV パス一覧を返す。"""
    os.makedirs(out_dir, exist_ok=True)
    csv_paths = []
    for i, url in enumerate(links):
        print(f"[{i + 1}/{len(links)}] {url}")
        res = session.get(url, headers=HEADERS, timeout=120)
        res.raise_for_status()
        if not res.content[:2] == b"PK":
            print("  -> zip ではないのでスキップ")
            continue

        base_name = os.path.splitext(os.path.basename(url.split("?")[0]))[0] or f"mesh_{i:04d}"
        dest_dir = os.path.join(out_dir, base_name)
        os.makedirs(dest_dir, exist_ok=True)

        with zipfile.ZipFile(io.BytesIO(res.content)) as zf:
            for name in zf.namelist():
                if name.lower().endswith((".txt", ".csv")):
                    zf.extract(name, dest_dir)
                    csv_paths.append(os.path.join(dest_dir, name))
    return csv_paths


# ----------------------------------------------------------------------------
# 2) メッシュコード関連ユーティリティ (JIS X 0410 4次メッシュ / 500m / 9桁)
# ----------------------------------------------------------------------------
def mesh_code_500m(lat: float, lon: float) -> str:
    """
    緯度経度 (10進数度) から JIS X 0410 500m（第4次 / 2分の1地域）メッシュコード (9桁) を計算する。
    1次 (4桁) + 2次 (2桁) + 3次 (2桁) + 4次 (1桁: 1=南西, 2=南東, 3=北西, 4=北東)
    """
    p = int(lat * 1.5)
    u = int(lon - 100.0)
    rem_lat = (lat * 60.0) - (p * 40.0)
    rem_lon = (lon - int(lon)) * 60.0

    q = min(max(int(rem_lat // 5.0), 0), 7)
    v = min(max(int(rem_lon // 7.5), 0), 7)
    rem_lat2 = rem_lat - (q * 5.0)
    rem_lon2 = rem_lon - (v * 7.5)

    r = min(max(int(rem_lat2 // 0.5), 0), 9)
    w = min(max(int(rem_lon2 // 0.75), 0), 9)
    rem_lat3 = rem_lat2 - (r * 0.5)
    rem_lon3 = rem_lon2 - (w * 0.75)

    m_lat = 1 if rem_lat3 >= 0.25 else 0
    m_lon = 1 if rem_lon3 >= 0.375 else 0
    m = (m_lat * 2 + m_lon) + 1

    return f"{p:02d}{u:02d}{q}{v}{r}{w}{m}"


def mesh_500m_to_latlon(code: str) -> tuple[float, float]:
    """9桁 500m メッシュコードを中心緯度・中心経度 (10進数度) に変換する。"""
    p = int(code[0:2])
    u = int(code[2:4])
    q = int(code[4])
    v = int(code[5])
    r = int(code[6])
    w = int(code[7])
    m = int(code[8]) - 1

    m_lat = m // 2
    m_lon = m % 2

    lat_center = (p * 40.0 + q * 5.0 + r * 0.5 + m_lat * 0.25 + 0.125) / 60.0
    lon_center = 100.0 + u + (v * 7.5 + w * 0.75 + m_lon * 0.375 + 0.1875) / 60.0
    return lat_center, lon_center


def neighbors(code: str) -> list[str]:
    """
    500m メッシュ (9桁) の周囲8近傍（東西・南北・斜め）のコードを返す。
    中心座標を緯度経度ステップで移動して再計算するため、1次・2次・3次メッシュ境界の繰り上がりも正確に処理する。
    """
    if len(code) != 9:
        raise ValueError(f"500m メッシュコードは9桁である必要があります: {code}")

    lat_c, lon_c = mesh_500m_to_latlon(code)
    lat_step = 0.25 / 60.0   # 15秒 = 0.25分
    lon_step = 0.375 / 60.0  # 22.5秒 = 0.375分

    out = []
    for da in (-1, 0, 1):
        for db in (-1, 0, 1):
            if da == 0 and db == 0:
                continue
            out.append(mesh_code_500m(lat_c + da * lat_step, lon_c + db * lon_step))
    return out


# ----------------------------------------------------------------------------
# 3) 人口の集計と密度テーブル生成
# ----------------------------------------------------------------------------
def _detect_columns(header_cols: list[str]) -> tuple[str | None, str | None]:
    """ヘッダー列からメッシュコード列と総人口列を特定する。"""
    code_col = None
    for c in header_cols:
        cu = c.strip().upper()
        if "KEY_CODE" in cu or "メッシュ" in c:
            code_col = c
            break

    pop_col = None
    for c in header_cols:
        cs = c.strip()
        if cs == "T001101001" or POP_COL_RE.match(cs):
            pop_col = c
            break

    return code_col, pop_col


def load_population(csv_paths: list[str]) -> dict[str, float]:
    """
    全メッシュテキスト (tblT001101H*.txt 等) を読み、{mesh_code: 総人口} の辞書を返す。
    CP932 / UTF-8、フォルダ階層化、e-Stat 500m テーブル形式に対応。
    """
    pop: dict[str, float] = {}
    valid_files = 0

    for path in csv_paths:
        head = None
        used_enc = "cp932"
        for enc in ("cp932", "utf-8"):
            try:
                head = pd.read_csv(path, encoding=enc, nrows=2, dtype=str)
                used_enc = enc
                break
            except UnicodeDecodeError:
                continue
            except Exception:
                break

        if head is None or head.empty:
            continue

        code_col, pop_col = _detect_columns(list(head.columns))

        # ヘッダー列名で見つからない場合、1行目の日本語ラベル行を検証
        if not pop_col and len(head) > 0:
            for c in head.columns:
                label = str(head[c].iloc[0]).replace(" ", "").replace("　", "")
                if "人口（総数）" in label or "総人口" in label:
                    pop_col = c
                    break

        if not code_col or not pop_col:
            continue

        try:
            df = pd.read_csv(path, encoding=used_enc, usecols=[code_col, pop_col], dtype=str)
        except Exception:
            try:
                df = pd.read_csv(path, encoding="cp932", dtype=str)
            except Exception:
                continue

        vals = pd.to_numeric(df[pop_col], errors="coerce")
        valid = df[code_col].notna() & vals.notna()

        for code, v in zip(df.loc[valid, code_col], vals[valid]):
            pop[str(code).strip()] = float(v)

        valid_files += 1

    print(f"読込完了: {valid_files} ファイルから {len(pop):,} 件の 500m メッシュ人口を取得")
    return pop


def density_lookup(
    pop: dict[str, float],
    target_codes: list[str] | set[str] | None = None,
) -> dict[str, float]:
    """
    指定メッシュコード（未指定時は pop 全体）について、自身+8近傍の平均人口密度 (人/km^2) を返す。
    無人口メッシュや近傍に人口データが存在しない場合は 0.0 とする。
    """
    dens: dict[str, float] = {}
    codes_to_eval = target_codes if target_codes is not None else pop.keys()

    for code in codes_to_eval:
        cells = [c for c in [code] + neighbors(code) if c in pop]
        if cells:
            dens[code] = sum(pop[c] for c in cells) / (len(cells) * CELL_AREA_KM2)
        else:
            dens[code] = 0.0
    return dens


def build_station_density(
    stations: pd.DataFrame,
    dens: dict[str, float],
    pop: dict[str, float] | None = None,
) -> pd.DataFrame:
    """観測点テーブルと人口密度マップを結合し、観測点ごとの 500m メッシュコードと人口密度テーブルを構築する。"""
    rows = []
    for _, st in stations.iterrows():
        lat = float(st["lat"])
        lon = float(st["lon"])
        code = mesh_code_500m(lat, lon)
        d = dens.get(code)

        if d is None and pop is not None:
            cells = [c for c in [code] + neighbors(code) if c in pop]
            d = sum(pop[c] for c in cells) / (len(cells) * CELL_AREA_KM2) if cells else 0.0

        st_name = (
            st.get("station")
            or st.get("station_id")
            or st.get("name")
            or ""
        )

        rows.append({
            "station": st_name,
            "lat": lat,
            "lon": lon,
            "mesh_code": code,
            "population_density_km2": round(d, 2) if d is not None else 0.0,
        })
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------
# 4) main
# ----------------------------------------------------------------------------
def main() -> None:
    default_mesh_dir = "station_noise/raw" if os.path.exists("station_noise/raw") else "csv/mesh_r2_500m"
    default_stations = (
        "public/data/stations/stations_meta.json"
        if os.path.exists("public/data/stations/stations_meta.json")
        else "public/data/stations.csv"
    )
    default_out = (
        "station_noise/prepared/station_density.csv"
        if os.path.exists("station_noise")
        else "public/data/station_density.csv"
    )

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--stations", default=default_stations, help="観測点メタデータ (JSON / CSV)")
    ap.add_argument("--mesh-dir", default=default_mesh_dir, help="メッシュテキスト展開先フォルダ (各サブフォルダ内 tbl*.txt を含む)")
    ap.add_argument("--out", default=default_out, help="出力CSVパス")
    ap.add_argument("--copy-to-public", action="store_true", help="public/data/ にも station_density.csv / .npz をコピー出力する")
    args = ap.parse_args()

    session = requests.Session()

    # サブフォルダ含めて .txt / .csv を再帰走査（隠しファイルや .zip を除外）
    csv_paths = []
    if os.path.exists(args.mesh_dir):
        for root, _, files in os.walk(args.mesh_dir):
            csv_paths += [
                os.path.join(root, f)
                for f in files
                if f.lower().endswith((".txt", ".csv")) and not f.startswith(".")
            ]

    if not csv_paths:
        print(f"'{args.mesh_dir}' にテキストファイルが見つかりません。e-Stat から 500m メッシュ zip を検索中...")
        links = discover_mesh_zip_links(session)
        print(f"zip {len(links)} 件を検出")
        csv_paths = download_mesh_csvs(session, links, args.mesh_dir)

    print(f"読み込み対象ファイル: {len(csv_paths)} 件")
    pop = load_population(csv_paths)

    stations_path = args.stations
    if not os.path.exists(stations_path):
        fallback = "public/data/stations/stations_meta.json"
        if os.path.exists(fallback):
            print(f"指定された '{stations_path}' が見つからないため、'{fallback}' を使用します。")
            stations_path = fallback
        else:
            raise FileNotFoundError(f"観測点ファイルが見つかりません: {stations_path}")

    if stations_path.lower().endswith(".json"):
        stations = pd.read_json(stations_path)
    else:
        try:
            stations = pd.read_csv(stations_path)
        except Exception:
            stations = pd.read_json(stations_path)

    print(f"観測点数: {len(stations)} 件")

    # 全観測点のメッシュコードを計算し、必要なメッシュについて近傍平均密度を計算
    st_codes = {mesh_code_500m(float(st["lat"]), float(st["lon"])) for _, st in stations.iterrows()}
    dens = density_lookup(pop, target_codes=st_codes)

    result = build_station_density(stations, dens, pop=pop)

    out_csv = args.out
    os.makedirs(os.path.dirname(out_csv) or ".", exist_ok=True)
    result.to_csv(out_csv, index=False, encoding="utf-8")
    print(f"書き出し: {out_csv} ({len(result)} 観測点)")

    # シミュレータ用バイナリ (.npz)
    npz_path = os.path.splitext(out_csv)[0] + ".npz"
    np.savez(
        npz_path,
        lats=result["lat"].to_numpy(np.float32),
        lons=result["lon"].to_numpy(np.float32),
        density=result["population_density_km2"].to_numpy(np.float32),
    )
    print(f"書き出し: {npz_path}")

    if args.copy_to_public or os.path.abspath(out_csv) != os.path.abspath("public/data/station_density.csv"):
        # public/data/ ディレクトリが存在していれば public/data/ にも併せて出力
        public_csv = "public/data/station_density.csv"
        public_npz = "public/data/station_density.npz"
        if os.path.exists("public/data"):
            result.to_csv(public_csv, index=False, encoding="utf-8")
            np.savez(
                public_npz,
                lats=result["lat"].to_numpy(np.float32),
                lons=result["lon"].to_numpy(np.float32),
                density=result["population_density_km2"].to_numpy(np.float32),
            )
            print(f"書き出し (public): {public_csv} & {public_npz}")

    print("\n--- 人口密度統計 (人/km^2) ---")
    print(result["population_density_km2"].describe())


if __name__ == "__main__":
    main()