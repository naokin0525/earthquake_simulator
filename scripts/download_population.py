import os
import re
import sys
import time
import zipfile

import requests

# ---------- 設定 ----------
SEARCH_URL = (
    "https://www.e-stat.go.jp/gis/statmap-search"
    "?page={page}&type=1"
    "&toukeiCode=00200521"
    "&toukeiYear=2020"
    "&aggregateUnit=H"
    "&serveyId=H002005112020"
    "&statsId=T001101"
    "&datum=2000"
)

DOWNLOAD_URL = (
    "https://www.e-stat.go.jp/gis/statmap-search/data"
    "?statsId=T001101&code={code}&downloadType=2"
)

OUTPUT_DIR = "C:/Users/naoya/Downloads/素材/プログラム/earthquake_simulator/station_noise/raw"
MANUAL_CODES = [6840, 6842, 6848, 6740, 6742, 6748, 6642, 6644, 6646, 6540, 6542, 6544, 6546, 6440, 6442, 6444, 6340, 6342, 6240, 6140, 6040, 5940, 5942, 5840, 5738, 5740, 5636, 5638, 5640, 5536, 5538, 5540, 5432, 5436, 5438, 5440, 5332, 5334, 5336, 5338, 5340, 5232, 5234, 5236, 5238, 5240, 5130, 5132, 5134, 5136, 5138, 5030, 5032, 5034, 5036, 5038, 4928, 4930, 4932, 4934, 4828, 4830, 4728, 4730, 4740, 4630, 4530, 4540, 4440, 4328, 4230, 4128, 4142, 4028, 4040, 4042, 3926, 3928, 3942, 3824, 3724, 3622, 3624, 3036, 6841, 6847, 6741, 6747, 6641, 6643, 6645, 6647, 6541, 6543, 6545, 6439, 6441, 6443, 6445, 6339, 6341, 6343, 6239, 6241, 6243, 6139, 6141, 6039, 6041, 5939, 5941, 5839, 5841, 5739, 5741, 5637, 5639, 5641, 5531, 5537, 5539, 5541, 5433, 5435, 5437, 5439, 5333, 5335, 5337, 5339, 5229, 5231, 5233, 5235, 5237, 5239, 5129, 5131, 5133, 5135, 5137, 5139, 5029, 5031, 5033, 5035, 5039, 4929, 4931, 4933, 4939, 4829, 4831, 4839, 4729, 4731, 4739, 4629, 4631, 4529, 4531, 4429, 4329, 4229, 4129, 4027, 3927, 3823, 3831, 3841, 3725, 3741, 3623, 3631, 3641, 3653]  # 例: ["3622", "3623"]
MAX_PAGES = 50         
REQUEST_INTERVAL = 1.0 

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en;q=0.8",
}

session = requests.Session()
session.headers.update(HEADERS)


def collect_codes() -> list[str]:
    """検索ページを巡回してダウンロード用 code を収集する。"""
    codes: list[str] = []
    pattern = re.compile(
        r"code=(\d+)"  # statmap-search/data?...code=XXXXX 形式のリンク
    )

    for page in range(1, MAX_PAGES + 1):
        url = SEARCH_URL.format(page=page)
        print(f"[検索ページ取得] page={page} : {url}")
        resp = session.get(url, timeout=60)
        resp.raise_for_status()

        found = sorted(set(pattern.findall(resp.text)))
        new_codes = [c for c in found if c not in codes]
        if not new_codes:
            print("  -> 新しい code が見つからないため巡回を終了します。")
            break

        codes.extend(new_codes)
        print(f"  -> {len(new_codes)} 件の code を検出（累計 {len(codes)} 件）")
        time.sleep(REQUEST_INTERVAL)

    return codes


def download_zip(code: str) -> str:
    """指定 code の ZIP をダウンロードして保存パスを返す。"""
    url = DOWNLOAD_URL.format(code=code)
    out_path = os.path.join(OUTPUT_DIR, f"T001101_{code}.zip")

    if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
        print(f"[スキップ] {out_path} は既に存在します。")
        return out_path

    resp = session.get(url, timeout=300, stream=True)
    resp.raise_for_status()

    with open(out_path, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1 << 20):
            f.write(chunk)
    with open(out_path, "rb") as f:
        head = f.read(4)
        f.seek(-22, os.SEEK_END)
        tail = f.read(22)

    if head[:4] != b"PK\x03\x04" and tail[-2:] != b"PK\x05\x06":
        os.remove(out_path)
        raise RuntimeError(
            f"code={code}: ZIPではない応答が返されました "
            f"(Content-Type={resp.headers.get('Content-Type')})"
        )

    print(f"[完了] {out_path} ({os.path.getsize(out_path):,} bytes)")
    return out_path


def extract_zip(zip_path: str) -> None:
    """ZIP を同じ名前のフォルダに展開する。"""
    dest = os.path.splitext(zip_path)[0]
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(dest)
    print(f"[展開] {dest}/")


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    codes = MANUAL_CODES or collect_codes()
    if not codes:
        print("code が取得できませんでした。MANUAL_CODES に直指定してください。")
        sys.exit(1)

    print(f"ダウンロード対象: {len(codes)} 件")
    failed = []

    for i, code in enumerate(codes, 1):
        print(f"--- {i}/{len(codes)} --- code={code}")
        try:
            zip_path = download_zip(code)
            extract_zip(zip_path)  # 展開不要ならコメントアウト
        except Exception as e:
            print(f"[エラー] code={code}: {e}")
            failed.append(code)
        time.sleep(REQUEST_INTERVAL)

    print("\n=== 結果 ===")
    print(f"成功: {len(codes) - len(failed)} / {len(codes)}")
    if failed:
        print("失敗した code:", ", ".join(failed))
        sys.exit(2)


if __name__ == "__main__":
    main()