from pathlib import Path

import geopandas as gpd

ROOT = Path(__file__).resolve().parents[1]
INPUT_SHAPEFILE = (
    ROOT
    / "data_references"
    / "20240520_AreaForecastLocalE_GIS"
    / "地震情報／細分区域.shp"
)
REFERENCE_GEOJSON = (
    ROOT
    / "data_references"
    / "20240520_AreaForecastLocalE_GIS"
    / "sub_regions.geojson"
)
PUBLIC_GEOJSON = ROOT / "public" / "data" / "sub_regions.geojson"
PREFECTURES_GEOJSON = ROOT / "public" / "data" / "prefectures.geojson"

print("Reading JMA Shapefile...")
gdf = gpd.read_file(INPUT_SHAPEFILE, encoding="utf-8")
if gdf.crs is None:
    print("Assigning EPSG:6668...")
    gdf = gdf.set_crs("EPSG:6668")
print("Projecting to WGS84...")
gdf = gdf.to_crs(epsg=4326)

print(f"Writing full reference GeoJSON to {REFERENCE_GEOJSON}...")
REFERENCE_GEOJSON.parent.mkdir(parents=True, exist_ok=True)
gdf.to_file(REFERENCE_GEOJSON, driver="GeoJSON")

runtime_gdf = gdf.copy()

prefectures = gpd.read_file(PREFECTURES_GEOJSON, encoding="utf-8").to_crs(epsg=4326)
prefecture_codes = []
for geometry in runtime_gdf.geometry:
    representative_point = geometry.representative_point()
    matches = prefectures.loc[prefectures.geometry.covers(representative_point), "pref"]
    if matches.empty:
        raise ValueError(f"Could not assign a prefecture to forecast region {geometry.wkt[:120]}")
    prefecture_codes.append(int(matches.iloc[0]))
runtime_gdf["pref"] = prefecture_codes
PUBLIC_GEOJSON.parent.mkdir(parents=True, exist_ok=True)
runtime_gdf.to_file(PUBLIC_GEOJSON, driver="GeoJSON")
print(f"Browser-ready sub-region GeoJSON saved to {PUBLIC_GEOJSON}")
