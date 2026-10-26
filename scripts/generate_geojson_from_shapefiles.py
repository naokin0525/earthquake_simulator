import geopandas as gpd

input_shapefile = "C:/Users/naoya/Downloads/素材/プログラム/earthquake_simulator/data_references/20240520_AreaForecastLocalE_GIS/地震情報／細分区域.shp"
output_geojson = "C:/Users/naoya/Downloads/素材/プログラム/earthquake_simulator/data_references/20240520_AreaForecastLocalE_GIS/sub_regions.geojson"

try:
    print("Reading JMA Shapefile...")
    gdf = gpd.read_file(input_shapefile, encoding="utf-8")
    if gdf.crs is None:
        print("Assigning EPSG:6668...")
        gdf.crs = "EPSG:6668"
    print("Projecting to universal GPS degrees...")
    gdf = gdf.to_crs(epsg=4326)
    print("Exporting to GeoJSON format...")
    gdf.to_file(output_geojson, driver="GeoJSON")
    print(f"\n file saved to: {output_geojson}")
    print("\n--- Data Sample Preview ---")
    print(gdf[["geometry"]].head())

except Exception as e:
    print(f"An error occurred: {e}")
