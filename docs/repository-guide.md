# Repository and file guide

This guide describes the versioned project structure and the local-only data
directories used by the application and preparation scripts. Keep generated
outputs and source datasets separate: source code belongs in `src/`, tests in
`tests/`, browser assets in `public/`, and source/reference data in the local
data directories.

## Application source

| File or directory | Role |
| --- | --- |
| `src/main.tsx` | Creates the React root and loads the application stylesheet |
| `src/App.tsx` | Composes the map, simulation provider, and on-map panels |
| `src/index.css` | Global styles and application layout styling |
| `src/context/SimulationContext.tsx` | Owns simulation state, setup, ticking, and UI-facing state updates |
| `src/hooks/useSimulation.ts` | Hook for reading simulation context |
| `src/components/map/MapContainer.tsx` | Initializes the map and coordinates map overlays |
| `src/components/map/layers/HypocenterLayer.ts` | Renders the earthquake hypocenter marker |
| `src/components/map/layers/MeshIntensityLayer.ts` | Displays mesh-based shaking intensity tiles |
| `src/components/map/layers/StationsLayer.ts` | Displays observation stations and station state |
| `src/components/map/layers/WaveFrontLayer.ts` | Draws propagating P- and S-wave fronts |
| `src/components/ui/ControlPanel.tsx` | Simulation controls and scenario inputs |
| `src/components/ui/EEWBanner.tsx` | EEW alert banner |
| `src/components/ui/EEWHud.tsx` | EEW report and hypocenter information overlay |
| `src/components/ui/JmaTimeline.tsx` | Timeline and report progression display |
| `src/components/ui/Legend.tsx` | Map intensity and wave legend |
| `src/components/ui/StrongMotionMonitor.tsx` | Strong-motion monitoring panel |
| `src/core/types.ts` | Shared domain and simulation types |
| `src/core/simulationState.ts` | Simulation defaults and state-transition helpers |
| `src/core/simulation/EventSequencer.ts` | Creates and advances simulation event sequences |
| `src/core/simulation/SimulationEngine.ts` | Advances station and seismic-wave simulation state |
| `src/core/eew/EEWEngine.ts` | Produces EEW reports and evaluates warning thresholds |
| `src/core/eew/eewInversion.ts` | Estimates hypocenter and magnitude from triggered observations |
| `src/core/physics/attenuation.ts` | Ground-motion attenuation and related intensity calculations |
| `src/core/physics/distance.ts` | Geographic and hypocentral distance calculations |
| `src/core/physics/intensity.ts` | Converts ground-motion values into seismic intensity |
| `src/core/physics/intensityFilter.ts` | Filters and smooths intensity values |
| `src/core/physics/lpgm.ts` | Estimates long-period ground motion |
| `src/core/physics/siteResponse.ts` | Site-response adjustments |
| `src/core/physics/slabModel.ts` | Loads Slab2 grids and estimates slab-path effects |
| `src/core/physics/travelTime.ts` | Seismic travel-time and wave-distance calculations |
| `src/core/ui/EEWFormatter.ts` | Formats EEW reports for presentation |
| `src/core/ui/KyoshinColorUtils.ts` | Color mapping for intensity and monitoring displays |
| `src/core/utils/colorUtils.ts` | Shared color conversion and interpolation helpers |
| `src/core/utils/eewUtils.ts` | EEW-specific utility functions |
| `src/core/viz/MapLayers.ts` | Shared map visualization layer definitions |
| `src/loaders/AmpFactorTileLoader.ts` | Loads amplification-factor mesh tiles |
| `src/loaders/NoiseLoader.ts` | Loads station noise/density data |
| `src/loaders/StationLoader.ts` | Loads station coordinates, metadata, and binary data |
| `src/utils/audioAlert.ts` | Plays browser audio alerts |
| `src/workers/simulation.worker.ts` | Runs simulation updates away from the UI thread |

## Tests

Tests are grouped by behavior area and use Vitest. Keep test files under
`tests/`; the configured test glob runs `*.test.ts` files there.

| File | Role |
| --- | --- |
| `tests/eew/eewInversion.test.ts` | Hypocenter inversion and EEW warning behavior |
| `tests/physics/attenuation.test.ts` | Attenuation calculations |
| `tests/physics/intensity.test.ts` | Seismic intensity calculations |
| `tests/physics/lpgm.test.ts` | Long-period ground-motion calculations |
| `tests/physics/siteResponse.test.ts` | Site-response adjustments |
| `tests/physics/slabModel.test.ts` | Slab2 grid decoding and path calculations |
| `tests/simulation/eventSequencer.test.ts` | Simulation event sequencing |
| `tests/simulation/simulationEngine.test.ts` | Simulation state transitions and wave propagation |
| `tests/simulation/simulationState.test.ts` | Default state/configuration and warning transition behavior |
| `tests/ui/eewFormatter.test.ts` | EEW report formatting |
| `tests/ui/waveFrontLayer.test.ts` | Wave-front layer behavior |

## Data preparation and browser assets

| File or directory | Role |
| --- | --- |
| `scripts/download_population.py` | Downloads population source data for the preparation workflow |
| `scripts/generate_mesh_tiles.py` | Generates browser map mesh tiles |
| `scripts/generate_slab2_png.py` | Converts paired Slab2 XYZ grids to browser-ready PNGs and a manifest |
| `scripts/prepare_boundaries.sh` | Converts boundary GeoJSON into PMTiles using Tippecanoe |
| `scripts/prepare_population_density.py` | Prepares population-density inputs |
| `scripts/prepare_stations.py` | Prepares station data and metadata |
| `public/logo/epicenter.svg` | Runtime marker asset served at `/logo/epicenter.svg` |
| `public/data/slab2/manifest.json` | Slab2 raster extents and decoding metadata |
| `public/data/slab2/izu_dep.png`, `izu_thk.png` | Izu-Bonin slab depth and thickness rasters |
| `public/data/slab2/kur_dep.png`, `kur_thk.png` | Kuril/Japan slab depth and thickness rasters |
| `public/data/slab2/ryu_dep.png`, `ryu_thk.png` | Ryukyu/Nankai slab depth and thickness rasters |
| `logo/epicenter.svg` | Source artwork for the epicenter marker; `public/logo/` is the served runtime copy |
| `docs/slab2-pipeline.md` | Slab2 input format, generation command, and raster encoding notes |

The application also expects generated station, prefecture, boundary, density,
and mesh files at the URL paths used by the loaders and map layers (for example
`/data/stations/`, `/data/prefectures.geojson`, `/data/boundaries/`, and
`/tiles/mesh/`). These larger/generated files are intentionally kept out of
version control.

## Root configuration

| File | Role |
| --- | --- |
| `index.html` | Vite HTML entry point |
| `package.json` | Application dependencies and development/build/test commands |
| `package-lock.json` | Locked npm dependency versions |
| `tsconfig.json` | TypeScript compiler settings and source/test inclusion |
| `vite.config.ts` | Vite build and Vitest configuration |
| `.gitignore` | Excludes dependencies, generated outputs, local datasets, and worktrees |

## Local-only data and generated output

These directories are present in some working copies but are not checked-in
application source. The individual input files have distinct roles:

| Path | Role |
| --- | --- |
| `data_references/20190125_AreaForecast_GIS.zip` | Archived JMA forecast-area GIS source |
| `data_references/20240520_AreaForecastLocalE_GIS/地震情報／細分区域.shp` | Forecast-area boundary geometries |
| `data_references/20240520_AreaForecastLocalE_GIS/地震情報／細分区域.dbf` | Attributes for those boundary geometries |
| `data_references/20240520_AreaForecastLocalE_GIS/地震情報／細分区域.shx` | Shape index for the boundary geometries |
| `data_references/D-V4-STRUCT_DEEP-LYRD.csv`, `D-V4-STRUCT_DEEP-PYS.csv` | Deep subsurface structure reference tables |
| `data_references/Issuance Rules.md`, `JMA_Steps.md`, `Z-RULES.pdf` | EEW issuance and source-data reference material |
| `data_references/prefectures.geojson` | Prefecture boundary source; fallback input for boundary tile generation |
| `data_references/sites.md` | Notes about source sites and data provenance |
| `data_references/stationlist_all.csv` | Station inventory; fallback input for station preparation |
| `data_references/Z-V4-JAPAN-AMP-VS400_M250.csv` | Mesh amplification source; fallback input for mesh tile generation |
| `data_references/slab2/izu_slab2_dep_02.24.18.xyz`, `izu_slab2_thk_02.24.18.xyz` | Izu-Bonin slab depth and thickness source grids |
| `data_references/slab2/kur_slab2_dep_02.24.18.xyz`, `kur_slab2_thk_02.24.18.xyz` | Kuril/Japan slab depth and thickness source grids |
| `data_references/slab2/ryu_slab2_dep_02.26.18.xyz`, `ryu_slab2_thk_02.26.18.xyz` | Ryukyu/Nankai slab depth and thickness source grids |
| `station_noise/raw/T001101_*.zip` | Raw Statistics Bureau population mesh archives downloaded by `scripts/download_population.py` |
| `station_noise/prepared/station_density.csv`, `station_density.npz` | Prepared station-density data consumed by the application |
| `public/data/` and `public/tiles/` | Prepared browser-served datasets and map tiles, except the checked-in Slab2 assets |
| `build/` and `dist/` | Generated build output; regenerate with the project build command |
| `.claude/worktrees/` | Local nested worktrees; not part of the application source tree |

`docs/slab2-pipeline.md` describes the complete Slab2 preparation path. The
source files in `data_references/slab2/` are required to regenerate the
versioned Slab2 rasters.
