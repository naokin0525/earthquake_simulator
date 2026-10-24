# Earthquake Simulator

A browser-based real-time earthquake and Earthquake Early Warning (EEW)
simulator for Japan. The React UI renders the map and simulation overlays;
the simulation and EEW engines calculate wave arrival, shaking intensity,
and warning updates.

## Getting started

```powershell
npm install
npm run dev
```

Run the unit tests with `npm test` and create a production build with
`npm run build`.

The full map also uses prepared geographic and station data that is not
committed to this repository. See [the repository guide](docs/repository-guide.md)
for the source map, data locations, and the role of each project file.
At startup, the app preloads all ground-amplification tiles listed in
`public/tiles/mesh/manifest.json` and shows their progress; deploy the matching
PNG files alongside the manifest.
Station-density data prepared by `scripts/prepare_population_density.py` is
published to `public/data/station_density.csv` and loaded from that URL at startup.

## Project map

| Path | Purpose |
| --- | --- |
| `src/` | Application UI, map layers, simulation, physics, data loaders, and worker |
| `tests/` | Unit tests organized by EEW, physics, simulation, and UI |
| `scripts/` | Preparation and conversion tools for geographic and station data |
| `public/` | Browser-served images and generated Slab2 grids |
| `data_references/` | Local source datasets and reference documents (not committed) |
| `station_noise/` | Prepared station-density inputs (not committed) |
| `docs/` | Technical notes and the detailed repository/file guide |
| `build/`, `dist/` | Generated output; do not edit by hand |
