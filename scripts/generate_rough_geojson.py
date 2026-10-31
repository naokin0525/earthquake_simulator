from pathlib import Path
import geopandas as gpd
from topojson.core.topology import Topology

ROOT = Path(__file__).resolve().parents[1]
INPUT_SHAPEFILE = (
    ROOT
    / "data_references"
    / "20240520_AreaForecastLocalE_GIS"
    / "地震情報／細分区域.shp"
)
PUBLIC_GEOJSON = ROOT / "public" / "data" / "sub_regions.geojson"
PREFECTURES_GEOJSON = ROOT / "public" / "data" / "prefectures.geojson"

print("1. Reading Shapefile and projecting to WGS84...")
gdf = gpd.read_file(INPUT_SHAPEFILE, encoding="utf-8")
if gdf.crs is None:
    gdf = gdf.set_crs("EPSG:6668")
gdf = gdf.to_crs(epsg=4326)

print("2. Mapping prefecture codes...")
prefectures = gpd.read_file(PREFECTURES_GEOJSON, encoding="utf-8").to_crs(epsg=4326)
prefecture_codes = []
for geometry in gdf.geometry:
    point = geometry.representative_point()
    matches = prefectures.loc[prefectures.geometry.covers(point), "pref"]
    if matches.empty:
        matches = prefectures.loc[prefectures.geometry.intersects(point), "pref"]
    if matches.empty:
        raise ValueError(f"Could not assign a prefecture to forecast region {geometry.wkt[:120]}")
    prefecture_codes.append(int(matches.iloc[0]))

gdf["pref"] = prefecture_codes

target_cols = [c for c in ["code", "name", "pref", "geometry"] if c in gdf.columns]
gdf = gdf[target_cols]

print("3. Building Topology (resolving shared borders)...")
topo = Topology(
    gdf,
    topology=True,
    prequantize=1e5,
    prevent_oversimplify=True
)

print("4. Simplifying boundaries without creating gaps or overlaps...")
simplified_topo = topo.toposimplify(
    keep=0.2,
    prevent_oversimplify=True
)

print("5. Exporting lightweight GeoJSON...")
PUBLIC_GEOJSON.parent.mkdir(parents=True, exist_ok=True)

simplified_topo.to_geojson(
    fp=PUBLIC_GEOJSON,
    decimals=4,
    winding_order="CCW_CW"
)

print(f"Success! Browser-ready sub-regions saved to {PUBLIC_GEOJSON}")