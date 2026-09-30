# Real-Time Earthquake & EEW Data Preprocessing Pipeline

An automated, ultra-fast data preprocessing pipeline in Python and Bash designed for client-side browser real-time Earthquake and Earthquake Early Warning (EEW) simulation applications.

This pipeline transforms heavy raw datasets (millions of 250m mesh records, thousands of seismograph stations, and complex administrative GeoJSON boundaries) into optimized binary buffers, RGB-encoded Web Mercator raster tile pyramids, and vector tiles (`.pmtiles`).

---

## Directory Layout

```
earthquake_simulator/
├── input_data/                      # Input raw dataset directory
│   ├── stations.csv                 # Seismograph station records
│   ├── jshis_mesh_250m.csv          # J-SHIS 250m mesh ARV data
│   └── japan_boundaries.geojson     # Administrative boundaries GeoJSON
├── public/                          # Output directory for web application static assets
│   ├── data/
│   │   ├── stations/
│   │   │   ├── stations.bin         # Little-endian packed station binary buffer
│   │   │   └── stations_meta.json   # Station metadata JSON array for UI tooltips
│   │   └── boundaries/
│   │       └── japan_admin.pmtiles  # Vector tiles for administrative boundaries
│   └── tiles/
│       └── mesh/                    # Web Mercator XYZ raster tile pyramid
│           └── {z}/{x}/{y}.png      # RGB-encoded ARV tiles (Z=5 to Z=10)
├── scripts/
│   ├── prepare_stations.py          # Task 1: Seismograph station binary packer
│   ├── generate_mesh_tiles.py       # Task 2: 250m Mesh GeoTIFF & XYZ tile generator
│   └── prepare_boundaries.sh        # Task 3: Tippecanoe vector tile Bash pipeline
├── src/
│   └── loaders/
│       └── StationLoader.ts         # Task 5: Client-side TypeScript loader module
├── requirements.txt                 # Task 4: Python dependencies specification
└── README.md                        # Task 6: Execution Guide & Documentation
```

---

## Prerequisites & Installation

### 1. Python Environment Setup
Install required Python packages:
```bash
pip install -r requirements.txt
```

### 2. Tippecanoe (Vector Tile Generator)
Install `tippecanoe` for generating `.pmtiles` vector tiles:
- **macOS (Homebrew)**: `brew install tippecanoe`
- **Linux (Ubuntu/Debian)**:
  ```bash
  sudo apt-get install build-essential libsqlite3-dev zlib1g-dev
  git clone https://github.com/felt/tippecanoe.git
  cd tippecanoe && make -j$(nproc) && sudo make install
  ```
- **Windows (WSL2)**: Install inside WSL Ubuntu environment.

---

## Step-by-Step Execution Guide

### Step 1: Preprocess Seismograph Stations (`prepare_stations.py`)
Cleans, validates coordinates within Japan bounds (Lat 20–46°, Lon 122–154°), and generates compact binary format `stations.bin` and JSON metadata `stations_meta.json`.

```bash
python scripts/prepare_stations.py --input input_data/stations.csv --output public/data/stations
```

*Note: If `input_data/stations.csv` is missing, it automatically falls back to `data_references/stationlist_all.csv` if available.*

### Step 2: Rasterize 250m Mesh & Generate Tile Pyramids (`generate_mesh_tiles.py`)
Rasterizes 250m J-SHIS mesh data into an RGB-encoded Web Mercator (EPSG:3857) raster tile pyramid ($Z=5$ to $Z=10$).

```bash
python scripts/generate_mesh_tiles.py --input input_data/jshis_mesh_250m.csv --output public/tiles/mesh --min-zoom 5 --max-zoom 10
```

*Note: Automatically decodes 10-digit JIS 250m mesh codes or 8-digit 1km mesh codes into WGS84 lat/lon centroids if lat/lon columns are omitted.*

### Step 3: Build Vector Tiles for Administrative Boundaries (`prepare_boundaries.sh`)
Converts administrative GeoJSON boundaries into optimized `.pmtiles` vector tiles.

```bash
bash scripts/prepare_boundaries.sh input_data/japan_boundaries.geojson public/data/boundaries/japan_admin.pmtiles
```

---

## Technical Specifications & Encoding Schemes

### 1. Seismograph Station Binary Stride (`stations.bin`)
- **Header**: 4 bytes (`uint32`), representing total station count $N$.
- **Record Stride**: 16 bytes per station (little-endian):
  - `lat`: `float32` (4 bytes, offset +0)
  - `lon`: `float32` (4 bytes, offset +4)
  - `amp_factor`: `float32` (4 bytes, offset +8, surface amplification ARV)
  - `pref_code`: `uint8` (1 byte, offset +12, 1–47 prefecture code)
  - `reserved`: `uint8[3]` (3 bytes padding, offset +13)

### 2. Mesh Tile RGB Encoding Scheme
- **R Channel (8-bit, 0–255)**: Encodes Surface Amplification Factor ($ARV$).
  - Mapping equation:
    $$\text{R\_val} = \text{clamp}\left(\left\lfloor \frac{ARV - 0.5}{3.0 - 0.5} \times 255 \right\rfloor, 0, 255\right)$$
- **G Channel (8-bit, 0–255)**: Subducting plate depth indicator (default 0).
- **B Channel (8-bit, 0–255)**: Deep sediment amplification or elevation (default 0).
- **Alpha Channel**: `255` for land/data pixels, `0` for ocean/nodata.

#### GLSL Fragment Shader Unpacking Code
```glsl
uniform sampler2D u_meshTile;
varying vec2 v_uv;

void main() {
    vec4 color = texture2D(u_meshTile, v_uv);
    if (color.a > 0.0) {
        // Reverse mapping formula: ARV range [0.5, 3.0]
        float arv = 0.5 + (color.r * (2.5 / 255.0));
        
        // Calculate ground motion amplification / Peak Ground Acceleration (PGA)
        // ...
    }
}
```

---

## Client-Side TypeScript Loader Integration Example

```typescript
import { StationLoader } from './src/loaders/StationLoader';

async function initSimulation() {
  const data = await StationLoader.loadStations(
    '/data/stations/stations.bin',
    '/data/stations/stations_meta.json'
  );

  console.log(`Loaded ${data.totalStations} seismograph stations.`);
  console.log('Latitude array:', data.lats);         // Float32Array
  console.log('Longitude array:', data.lons);       // Float32Array
  console.log('ARV Factors array:', data.ampFactors); // Float32Array
}
```
