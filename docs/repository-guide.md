The inventory above is a quick index. The sections below describe how the principal files work together. The numerical relations are simulation models and approximations; they are not a substitute for JMA observations or a site-calibrated ground-motion forecast.

## `src/`

### `src/main.tsx`

Browser entry point. It finds the HTML mount element, creates the React root, loads the global stylesheet, and renders the application.

### `src/App.tsx`

Composes the simulation provider, map, controls, startup/error presentation, and on-map report panels. It is the top-level UI composition rather than the place where seismic calculations are performed.

### `src/index.css`

Global typography, colors, layout, and responsive styling shared by the map and overlay panels.

## `src/context/` and `src/hooks/`

### `src/context/SimulationContext.tsx`

Owns UI-visible simulation state and connects React to the simulation Web Worker. It loads mesh tiles, station metadata, amplification factors, and density data during startup; reports loading progress/errors; and forwards play, pause, reset, seek, speed, and scenario changes. Worker messages update wave radii, station states, EEW/report data, milestones, and display options. The context also coordinates audio/speech preferences and optional ambient noise visualization. It is an orchestration layer, not the source of the physics formulas.

### `src/hooks/useSimulation.ts`

Small typed hook for consuming the simulation context from components. It keeps consumers on the shared provider API instead of importing context internals directly.

## `src/components/map/`

### `src/components/map/MapContainer.tsx`

Creates and configures the MapLibre map, controls its viewport and lifecycle, and combines the basemap with Deck.gl layers. It translates simulation state into map overlays such as the epicenter, station activity, intensity tiles, wave fronts, amplification, and optional Slab2/fault information.

### `src/components/map/layers/GroundAmplificationLayer.ts`

Renders mesh PNGs from `/tiles/mesh/{z}/{x}/{y}.png` as Deck.gl bitmap tiles. Its fragment shader decodes the red channel as `ARV = 0.5 + 2.5 * Rnormalized`, interpolates between blue/teal/yellow/orange/red color bands, and applies a translucent overlay. This is a map visualization/encoding path; it does not derive the physical amplification from AVS30.

### `src/components/map/layers/HypocenterLayer.ts`

Draws the hypocenter/epicenter marker and associated location styling on the map.

### `src/components/map/layers/MeshIntensityLayer.ts`

Loads and displays mesh-based intensity imagery or tiles, coloring geographic cells by their supplied predicted shaking values.

### `src/components/map/layers/StationsLayer.ts`

Displays station positions and their changing state (idle, P-wave triggered, or S-wave arrived), with visual intensity/monitoring information where available.

### `src/components/map/layers/WaveFrontLayer.ts`

Draws the expanding P- and S-wave fronts from the source. The radii are provided by the simulation engine and increase with elapsed simulation time according to the modeled wave velocities.

## `src/components/ui/`

### `src/components/ui/ControlPanel.tsx`

Provides controls for the hypocenter scenario, magnitude and depth, playback, time scale, and map/visualization options. Actions are sent through the simulation context.

### `src/components/ui/EEWBanner.tsx`

Shows the prominent warning state when the latest EEW report meets the warning condition.

### `src/components/ui/EEWHud.tsx`

Presents the current EEW report and estimated hypocenter details as a compact map overlay.

### `src/components/ui/JmaTimeline.tsx`

Shows the chronological report and milestone progression, making it possible to relate the simulation clock to warning/report events.

### `src/components/ui/Legend.tsx`

Explains the map's intensity colors, station/wave symbols, and other visible map encodings.

### `src/components/ui/StartupLoadingScreen.tsx`

Shows startup phase, tile progress, and recoverable loading errors while required map data and the simulation worker are initialized.

### `src/components/ui/StrongMotionMonitor.tsx`

Provides a strong-motion/monitor-style view of station activity and shaking information; the display is driven by simulation data rather than being an independent seismological calculation.

## `src/core/`

### `src/core/types.ts`

Defines the shared contracts used throughout the application: hypocenter and simulation configuration, station arrays and trigger states, JMA intensity labels, report/milestone structures, and the inbound/outbound Web Worker message protocol. These types make the UI, worker, and calculation modules agree on units and payload shapes.

### `src/core/simulationState.ts`

Holds the default hypocenter and creates simulation configuration, includingthe tick interval and simulated P-pick noise. It also detects the transition into an EEW warning state so the warning chime is not replayed for every updated report.

### `src/core/simulation/EventSequencer.ts`

Converts simulation updates into ordered JMA-style milestones and reports (EEW, intensity flash, earthquake information, LPGM, and final report). It tracks which events have already been emitted and aggregates station observations by prefecture. `estimateEpicenterRegionName` first checks recognizable sea-area bounds, then chooses the nearest prefecture centroid using a latitude-adjusted planar distance approximation.

### `src/core/simulation/SimulationEngine.ts`

Maintains the numerical ground-truth simulation. On initialization it precomputes each station's epicentral/hypocentral distance, P/S arrivals, slab path fraction, and noisy observed P trigger time. On each update it advances the clock, updates station states, and produces changing shaking/intensity values and trigger events. Gaussian pick noise is generated with the Box–Muller transform:

`z = sqrt(-2 ln u1) cos(2 pi u2)`, then `noise = z * standardDeviation`.

Typed arrays are used for per-station values to keep updates efficient.

### `src/core/eew/EEWEngine.ts`

Consumes triggered-station information to create/update EEW reports, estimate the source, and determine forecast/warning areas and thresholds. It coordinates the inversion and intensity-scale comparison helpers; report sequencing is handled separately by `EventSequencer`.

### `src/core/eew/eewInversion.ts`

Estimates hypocenter, origin time, and magnitude from station P-pick times and optional measured PGV. For a trial source, each station implies

`originTime_i = observedPick_i - hypocentralDistance_i / Vp`.

The candidate origin time is the median of these estimates. The location score uses a Huber-style robust loss on the timing residual `e` (threshold `delta = 0.2 s`): `e^2` when `|e| <= delta`, otherwise `2 delta |e| - delta^2`. A bounded coarse grid, a finer local grid, then iterative local refinement search Japan-region latitude/longitude and a candidate set of depths. Magnitude is selected by minimizing clipped log-PGV residuals over a 3.5–9.0 grid. This is a point-source inversion with fixed P velocity, not a full finite-fault inversion.

### `src/core/eew/plum.js`

Implements a PLUM-style estimate from local observations. For stations within the default 30 km radius of a target, it converts observed surface PGV back to bedrock PGV as `PGV600 = measuredPGV / max(0.1, ampFactor)`, takes the largest such value, then predicts target surface motion as `PGVsurface = max(PGV600) * targetARV` and converts that value to continuous intensity. With no observations, it returns zero motion. The utility is currently not imported elsewhere under `src/`, so it should be treated as an available implementation rather than assumed to be active in the runtime EEW path.

## `src/core/physics/`

### `src/core/physics/travelTime.ts`

Computes surface distance with the Haversine relation. For latitudes `phi1, phi2` and longitude difference `dLambda` (all angular inputs converted to radians):

`a = sin^2(dPhi/2) + cos(phi1) cos(phi2) sin^2(dLambda/2)`

`Delta = 2 R Earth atan2(sqrt(a), sqrt(1-a))`, using mean Earth radius `6371.0088 km`. Hypocentral distance includes depth `D`: `R = sqrt(Delta^2 + D^2)`. Arrival estimates are `Tp = t0 + R/Vp` and `Ts = t0 + R/Vs`, with baseline velocities `Vp = 6.0 km/s` and `Vs = 3.5 km/s`. A clamped slab fraction `r` increases both modeled velocities by `1 + 0.12 r`.

### `src/core/physics/distance.ts`

Provides the point-source distance passed to attenuation calculations. Because there is no finite fault surface, it uses hypocentral distance as a practical proxy for rupture distance: `sqrt(Delta^2 + depth^2)`. The `closestFaultDistance` export is a compatibility alias, not a separate finite-fault geometry calculation.

### `src/core/physics/attenuation.ts`

Implements a Si & Midorikawa (1999)-form bedrock PGV model, a time envelope, and predicted continuous JMA intensity. With fault distance `R` in km, mean fault depth `D` in km, magnitude `Mw`, and slab-path fraction `r` clamped to `[0,1]`, the implemented relation is:

`log10(PGV600) = 0.58 Mw + 0.0038 min(D, 60 km) + C - 1.29 - log10(R + 0.0028 * 10^(0.50 Mw)) - 0.002 R + 0.12 r`

where `D` is capped at 60 km in the empirical depth term to avoid extrapolating it to deep-focus earthquakes, `C` is `0.00` for crustal, `-0.02` for interplate, or `+0.12` for intraplate events, and `PGV600 = 10^(right-hand side)` cm/s. If no fault type is supplied, the actual source depth provides a fallback classification (`<30 km` crustal, `30–<60 km` interplate, and `>=60 km` intraplate). The point-source model uses hypocentral distance for `R`, not a modeled fault-plane distance. Stations whose predicted discrete intensity is JMA 0 remain inactive in the simulation display.

The `envelope` is zero before P arrival, ramps to about 15% of peak between P and S arrivals, rises quadratically to peak over 2.5 seconds after S arrival, then decays exponentially with `tau = 4 + 1.5 Mw` seconds. Surface PGV is converted to a continuous predicted intensity by `I = 2.68 + 1.72 log10(PGVsurface)` (with a low-value guard), then mapped to a discrete JMA label. This empirical PGV equivalent is not the official waveform-based instrumental-intensity computation in `intensity.ts`.

### `src/core/physics/siteResponse.ts`

Calculates a site amplification factor from average shear-wave velocity in the top 30 m (`AVS30`):

`log10(ARV) = 1.83 - 0.66 log10(AVS30)`.

The implementation guards AVS30 against zero, and surface PGV/PGA is the bedrock value multiplied by `max(0.5, ARV)`. This separates bedrock motion from a simple site-response adjustment.

### `src/core/physics/intensityFilter.ts`

Implements the JMA frequency-domain filter using a radix-2 FFT. The combined gain is `H(f) = FF(f) FH(f) FL(f)`, where `FF(f) = (1/f)^(1/2)`, `FH(f) = (1 + 0.694 y^2 + 0.241 y^4 + 0.0557 y^6 + 0.009664 y^8 + 0.00134 y^10 + 0.000155 y^12)^(-1/2)` with `y = f/10`, and `FL(f) = (1 - exp(-(f/0.5)^3))^(1/2)`. The signal is zero-padded, transformed, multiplied by this gain (including the conjugate-frequency bins), inverse-transformed, and cropped back to its original length.

### `src/core/physics/intensity.ts`

Calculates official-style instrumental intensity from three acceleration components. After unit normalization and JMA filtering, the components are combined at each sample as `a(t) = sqrt(NS(t)^2 + EW(t)^2 + UD(t)^2)`. It selects the acceleration threshold `a0` exceeded for a cumulative 0.3 seconds, then calculates `Iraw = 2 log10(a0) + 0.94`. The JMA rounding rule first rounds to two decimal places and truncates to one decimal place; thresholds map the result to `0–4`, `5-`, `5+`, `6-`, `6+`, or `7`. This differs from the PGV-derived intensity estimate in `attenuation.ts`.

### `src/core/physics/intensityFilter.ts` and `src/core/physics/intensity.ts`

These files form one calculation pipeline: `intensityFilter.ts` filters each component, while `intensity.ts` synthesizes the components and converts the 0.3-second threshold into an intensity label. The two file sections above describe each stage separately; this is a combined overview, not an additional module.

### `src/core/physics/lpgm.ts`

Computes long-period ground motion response. For each period from 1.6 to 7.8 seconds in 0.2-second steps, it models a 5%-damped single-degree-of- freedom oscillator and integrates its response to the acceleration waveform with the average-acceleration Newmark-beta method (`beta = 1/4`, `gamma = 1/2`). It takes the peak absolute velocity response across time and periods as `Sv`; class thresholds are 15, 50, and 100 (with a minimum detectable threshold of 5) for classes 1–4. If no waveform is available, a synthetic response factor scales modeled surface PGV; this is an estimate, not a measured response spectrum.

### `src/core/physics/slabModel.ts`

Decodes Slab2 depth/thickness rasters and manifest metadata, exposes depth areas/contours for display, and samples slab information along the path between source and station. The PNG stores a 16-bit code in red/green; nonzero depth codes decode as `offset + (code - 1)/scale`. The path calculation estimates a fraction of samples in the slab depth interval: sample count is `ceil(hypocentralRayLength / 5 km)`, and the returned fraction is `inSlabSamples / sampleCount`. It is a geometric correction input for travel-time/attenuation, not a 3-D velocity or Q inversion. See [`docs/slab2-pipeline.md`](slab2-pipeline.md) for raster production details.

### `src/core/physics/arvResolver.js`

Contains a standalone Web Mercator tile-coordinate and pixel-sampling helper. Its current example decoder uses only the red channel: 

`ARV = 0.5 + (R/255) * 2.5`

the green and blue channels are read but do not affect the result. The file describes this encoding as a placeholder, and it is not imported elsewhere under `src/`, so it should not be mistaken for the production station amplification path or the AVS30 formula in `siteResponse.ts`.

## `src/core/ui/`, `src/core/utils/`, and `src/core/viz/`

### `src/core/ui/EEWFormatter.ts`

Formats structured EEW reports into display and announcement text; report generation and threshold logic remain in the EEW engine.

### `src/core/ui/KyoshinColorUtils.ts`

Maps intensity/monitor values to colors used by the strong-motion-style visualization.

### `src/core/utils/colorUtils.ts`

Holds reusable color and interpolation helpers, including generation of ambient-noise display levels from density inputs. These visual values do not represent seismic observations.

### `src/core/utils/eewUtils.ts`

Provides small shared helpers for EEW report and warning processing.

### `src/core/viz/MapLayers.ts`

Defines shared visualization layer helpers/configuration used to keep map rendering conventions consistent across overlays.

## `src/loaders/`, `src/utils/`, and `src/workers/`

### `src/loaders/AmpFactorTileLoader.ts`

Loads amplification mesh tiles and associates station coordinates with mesh amplification values for use in the site-response calculation.

### `src/loaders/MeshTileLoader.ts`

Reads the mesh-tile manifest, preloads listed PNG assets, and reports completion/failure progress so the map does not silently start with an incomplete required tile set.

### `src/loaders/NoiseLoader.ts`

Loads and validates station-density values from `/data/station_density.csv`. These values are used for the optional ambient monitor visualization, not as ground-motion measurements.

### `src/loaders/StationLoader.ts`

Loads station locations and metadata into typed buffers used by the simulation, map layers, and worker.

### `src/utils/audioAlert.ts`

Encapsulates browser audio alerts and speech settings/capability checks used when warning state changes.

### `src/workers/simulation.worker.ts`

Worker entry point. It accepts the typed actions from `core/types.ts`, initializes and advances the simulation away from the UI thread, and returns ticks, reports, snapshots, milestones, readiness, and errors to the context.

## `scripts/`

### `scripts/download_population.py`

Downloads the source population-mesh archives used in the station-density preparation workflow.

### `scripts/prepare_population_density.py`

Converts the population input into prepared density data for station locations and publishes the browser-facing CSV. The resulting density is a visualization input, not an intensity or attenuation factor.

### `scripts/prepare_stations.py`

Transforms the station inventory into the runtime station data and metadata consumed by `StationLoader`.

### `scripts/prepare_boundaries.sh`

Prepares geographic boundary data for browser map rendering, including the PMTiles output consumed by the map.

### `scripts/generate_mesh_tiles.py`

Converts amplification mesh source values into browser PNG tiles and writes the mesh manifest. `--manifest-only` refreshes the inventory without regenerating tile images.

### `scripts/generate_slab2_png.py`

Combines Slab2 XYZ depth and thickness grids into quantized browser PNG rasters and their manifest. Zero indicates missing cells; depth/thickness codes are decoded using each region's offset and scale. The workflow and encoding are described in [`docs/slab2-pipeline.md`](slab2-pipeline.md).

## `tests/`

Tests use Vitest and check behaviors of the corresponding production modules. They are grouped by subsystem rather than by UI screen.

### `tests/eew/eewInversion.test.ts`

Checks hypocenter/magnitude inversion behavior, including station picks and warning-related expectations.

### `tests/physics/attenuation.test.ts`

Checks PGV attenuation, temporal envelope, and the related prediction helpers.

### `tests/physics/intensity.test.ts`

Checks waveform intensity synthesis, thresholding, rounding, and discrete JMA scale conversion.

### `tests/physics/lpgm.test.ts`

Checks response-spectrum calculations and LPGM classification.

### `tests/physics/siteResponse.test.ts`

Checks AVS30 amplification and bedrock-to-surface conversion.

### `tests/physics/slabModel.test.ts`

Checks raster decoding, contours, and slab-path calculations.

### `tests/simulation/eventSequencer.test.ts`

Checks ordering and emission of simulation milestones and reports.

### `tests/simulation/simulationEngine.test.ts`

Checks station triggers, wave propagation, and simulation updates.

### `tests/simulation/simulationState.test.ts`

Checks defaults/configuration and warning-transition behavior.

### `tests/ui/eewFormatter.test.ts`

Checks presentation formatting of EEW report data.

### `tests/ui/waveFrontLayer.test.ts`

Checks wave-front map layer behavior.

### `tests/ui/stationsLayer.test.ts`

Checks station-layer rendering/state behavior.

### `tests/ui/meshIntensityLayer.test.ts`

Checks mesh-intensity layer behavior.

### `tests/loaders/noiseLoader.test.ts`

Checks station-density CSV loading and validation.

### `tests/loaders/meshTileLoader.test.ts`

Checks mesh manifest/tile loading and startup progress/error handling.

## Root files and browser assets

### `index.html`

Vite's HTML entry point; provides the DOM mount point and loads the TypeScript application entry.

### `README.md`

Project overview and quick-start instructions. It points to this guide for data locations, generated assets, and a fuller map of the repository.

### `package.json` and `package-lock.json`

`package.json` declares React, MapLibre/Deck.gl, Vite, TypeScript, and Vitest dependencies and the `dev`, `build`, `test`, and `preview` commands. `package-lock.json` pins the resolved npm dependency graph for repeatable installs.

### `tsconfig.json`

Configures TypeScript compilation, including language/module settings and which application and test files are checked.

### `vite.config.ts`

Configures the Vite development/build pipeline and Vitest integration.

### `.gitignore`

Excludes dependency folders, generated build/data outputs, local datasets, and local worktrees so that runtime artifacts and private working data are not mistaken for versioned source.

### `logo/epicenter.svg` and `public/logo/epicenter.svg`

The former is source artwork; the latter is the browser-served runtime copy referenced by the app at `/logo/epicenter.svg`.

### `public/data/slab2/manifest.json`

Provides each Slab2 region's depth/thickness image paths, geographic bounds, grid dimensions, valid-cell count, and quantization offsets/scales used by `Slab2Model`.

### `public/data/slab2/izu_dep.png` and `public/data/slab2/izu_thk.png`

Quantized depth and thickness grids for the Izu-Bonin Slab2 region, respectively.

### `public/data/slab2/kur_dep.png` and `public/data/slab2/kur_thk.png`

Quantized depth and thickness grids for the Kuril/Japan Slab2 region, respectively.

### `public/data/slab2/ryu_dep.png` and `public/data/slab2/ryu_thk.png`

Quantized depth and thickness grids for the Ryukyu/Nankai Slab2 region, respectively.

### `public/tiles/mesh/manifest.json`

Versioned inventory used to find and preload the generated mesh PNG tiles. The manifest and its matching PNG set must be deployed together.

### `public/data/station_density.csv`

Browser-facing prepared density values loaded by `NoiseLoader` for the optional ambient display.

### `public/data/station_density.npz`

Prepared NumPy-format density data retained alongside the CSV output for preparation or analysis workflows. The browser loader reads the CSV, not this binary file.

### `public/data/prefectures.geojson` and `public/data/boundaries/`

Browser-served geographic shapes used by mapping/report overlays. The GeoJSON is also available as a source input under `data_references/`.

### `public/data/stations/`

Generated station coordinate/metadata files used to populate runtime station buffers; the station preparation script derives them from local inputs.

### `public/tiles/mesh/`

Generated amplification PNG tiles referenced by the checked-in manifest. These files are not committed and must be prepared/deployed with the corresponding tile inventory.

## `data_references/` and `station_noise/`

These local-only files are inputs or provenance references, not modules executed directly by the browser. The corresponding outputs are described in the data-preparation sections above.

### `data_references/20190125_AreaForecast_GIS.zip`

Archived JMA forecast-area GIS source retained for reference.

### `data_references/20240520_AreaForecastLocalE_GIS/地震情報／細分区域.shp`

Geometry records for forecast-area boundaries.

### `data_references/20240520_AreaForecastLocalE_GIS/地震情報／細分区域.dbf`

Attribute table paired with the forecast-area shape records.

### `data_references/20240520_AreaForecastLocalE_GIS/地震情報／細分区域.shx`

Spatial index paired with the forecast-area shapefile.

### `data_references/D-V4-STRUCT_DEEP-LYRD.csv` and `data_references/D-V4-STRUCT_DEEP-PYS.csv`

Deep subsurface structure reference tables. They provide context for regional structure; they are not directly read by the current browser simulation.

### `data_references/Issuance Rules.md`, `data_references/JMA_Steps.md`, and `data_references/Z-RULES.pdf`

Local reference documents for issuance rules and source-data interpretation. They inform project conventions but are not runtime inputs.

### `data_references/prefectures.geojson`

Source prefecture-boundary GeoJSON and fallback input for boundary preparation.

### `data_references/sites.md`

Notes about external source sites and data provenance.

### `data_references/stationlist_all.csv`

Source station inventory and fallback input for station-data preparation.

### `data_references/Z-V4-JAPAN-AMP-VS400_M250.csv`

Source mesh amplification values and fallback input for mesh-tile generation.

### `data_references/slab2/izu_slab2_dep_02.24.18.xyz` and `data_references/slab2/izu_slab2_thk_02.24.18.xyz`

Izu-Bonin Slab2 depth and thickness source grids, respectively.

### `data_references/slab2/kur_slab2_dep_02.24.18.xyz` and `data_references/slab2/kur_slab2_thk_02.24.18.xyz`

Kuril/Japan Slab2 depth and thickness source grids, respectively.

### `data_references/slab2/ryu_slab2_dep_02.26.18.xyz` and `data_references/slab2/ryu_slab2_thk_02.26.18.xyz`

Ryukyu/Nankai Slab2 depth and thickness source grids, respectively.

### `station_noise/raw/T001101_*.zip`

Raw Statistics Bureau population mesh archives used by `scripts/download_population.py` and the density preparation workflow.

### `station_noise/prepared/station_density.csv` and `station_noise/prepared/station_density.npz`

Prepared density outputs retained locally. The preparation script also publishes the CSV consumed by the browser under `public/data/`.

## Generated output and documentation

### `build/` and `dist/`

Generated application build output. Regenerate with `npm run build`; do not edit generated bundles manually.

### `docs/slab2-pipeline.md`

Documents how to regenerate Slab2 rasters, their encoding, and the limitations of the geometric path approximation.

### `docs/repository-guide.md`

This file: the project directory map, data provenance and handling notes, and the roles and key calculations of the files used by the simulator.
