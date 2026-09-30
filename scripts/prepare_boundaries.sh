#!/usr/bin/env bash
# ==============================================================================
# scripts/prepare_boundaries.sh
# ==============================================================================
# Converts administrative boundaries GeoJSON into an optimized vector tile pyramid (.pmtiles)
# using Tippecanoe.
#
# Zoom range: Z=3 to Z=10
# Flags:
#   --drop-densest-as-needed     Drop detail at lower zooms to stay under max byte limits
#   --coalesce-densest-as-needed Merge dense small features at lower zoom levels
#   --include=pref               Retain prefecture code / pref attribute
#   --include=name               Retain administrative name attribute
#   --force                      Overwrite output file if it exists
#
# Outputs:
#   public/data/boundaries/japan_admin.pmtiles
# ==============================================================================

set -euo pipefail

INPUT_GEOJSON="${1:-input_data/japan_boundaries.geojson}"
OUTPUT_PMTILES="${2:-public/data/boundaries/japan_admin.pmtiles}"

# Check for fallback reference dataset if default input does not exist
if [ ! -f "$INPUT_GEOJSON" ]; then
    FALLBACK_GEOJSON="data_references/prefectures.geojson"
    if [ -f "$FALLBACK_GEOJSON" ]; then
        echo "[INFO] '$INPUT_GEOJSON' not found. Using fallback reference dataset: '$FALLBACK_GEOJSON'"
        INPUT_GEOJSON="$FALLBACK_GEOJSON"
    else
        echo "[ERROR] Input GeoJSON file not found at '$INPUT_GEOJSON' or '$FALLBACK_GEOJSON'!" >&2
        exit 1
    fi
fi

# Ensure Tippecanoe is installed
if ! command -v tippecanoe &> /dev/null; then
    echo "[WARNING] 'tippecanoe' CLI command not found in PATH." >&2
    echo "  Please install tippecanoe (e.g., 'brew install tippecanoe' or build from source)." >&2
    echo "  Execution command for tippecanoe:" >&2
    echo "  tippecanoe -z10 -Z3 --drop-densest-as-needed --coalesce-densest-as-needed --include=pref --include=name --force -o $OUTPUT_PMTILES $INPUT_GEOJSON" >&2
    exit 1
fi

mkdir -p "$(dirname "$OUTPUT_PMTILES")"

echo "[INFO] Processing vector tiles with Tippecanoe..."
echo "  Input : $INPUT_GEOJSON"
echo "  Output: $OUTPUT_PMTILES"
echo "  Zoom  : Z=3 to Z=10"

tippecanoe \
    --minimum-zoom=3 \
    --maximum-zoom=10 \
    --drop-densest-as-needed \
    --coalesce-densest-as-needed \
    --include=pref \
    --include=name \
    --include=PREF \
    --include=NAME \
    --force \
    --output="$OUTPUT_PMTILES" \
    "$INPUT_GEOJSON"

echo "[SUCCESS] Boundary vector tiles generated at: $OUTPUT_PMTILES"
