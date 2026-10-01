/**
 * src/loaders/StationLoader.ts
 * =============================
 * High-performance browser binary loader and parser for seismograph station records.
 * Parses `stations.bin` (little-endian raw binary) and `stations_meta.json`.
 *
 * Binary Layout (16 bytes per station stride):
 *  - Header (bytes 0-3)  : uint32 representing station count N
 *  - Record (16 bytes)   :
 *      +0  lat         (float32, 4 bytes)
 *      +4  lon         (float32, 4 bytes)
 *      +8  ampFactor   (float32, 4 bytes, ARV)
 *      +12 prefCode    (uint8,   1 byte)
 *      +13 reserved    (uint8[3], 3 bytes padding)
 */
export class StationLoader {
    /**
     * Fetches and parses `stations.bin` and `stations_meta.json` from the server.
     *
     * @param binUrl Path or URL to `stations.bin` (e.g. '/data/stations/stations.bin')
     * @param metaUrl Path or URL to `stations_meta.json` (e.g. '/data/stations/stations_meta.json')
     */
    static async loadStations(binUrl = '/data/stations/stations.bin', metaUrl = '/data/stations/stations_meta.json') {
        // Fetch binary buffer and JSON metadata concurrently
        const [binResponse, metaResponse] = await Promise.all([
            fetch(binUrl),
            fetch(metaUrl)
        ]);
        if (!binResponse.ok) {
            throw new Error(`Failed to fetch stations binary file from ${binUrl}: ${binResponse.statusText}`);
        }
        if (!metaResponse.ok) {
            throw new Error(`Failed to fetch stations metadata file from ${metaUrl}: ${metaResponse.statusText}`);
        }
        const arrayBuffer = await binResponse.arrayBuffer();
        const metadata = await metaResponse.json();
        const dataView = new DataView(arrayBuffer);
        // Read header: uint32 total station count (little-endian)
        const totalStations = dataView.getUint32(0, true);
        const RECORD_BYTE_SIZE = 16;
        const HEADER_BYTE_SIZE = 4;
        const expectedMinBytes = HEADER_BYTE_SIZE + totalStations * RECORD_BYTE_SIZE;
        if (arrayBuffer.byteLength < expectedMinBytes) {
            throw new Error(`Invalid binary size: Expected at least ${expectedMinBytes} bytes, got ${arrayBuffer.byteLength} bytes`);
        }
        // Allocate continuous typed arrays for GPU / WebGL instanced attributes
        const lats = new Float32Array(totalStations);
        const lons = new Float32Array(totalStations);
        const ampFactors = new Float32Array(totalStations);
        const prefCodes = new Uint8Array(totalStations);
        const uint8View = new Uint8Array(arrayBuffer);
        for (let i = 0; i < totalStations; i++) {
            const offset = HEADER_BYTE_SIZE + i * RECORD_BYTE_SIZE;
            // Extract float32 fields using little-endian byte ordering
            lats[i] = dataView.getFloat32(offset + 0, true);
            lons[i] = dataView.getFloat32(offset + 4, true);
            ampFactors[i] = dataView.getFloat32(offset + 8, true);
            // Extract uint8 prefCode
            prefCodes[i] = uint8View[offset + 12];
        }
        return {
            totalStations,
            lats,
            lons,
            ampFactors,
            prefCodes,
            metadata
        };
    }
    /**
     * Helper function to query station details by index for UI hover/tooltips.
     */
    static getStationTooltip(dataSet, index) {
        if (index < 0 || index >= dataSet.totalStations)
            return null;
        const meta = dataSet.metadata[index];
        const lat = dataSet.lats[index].toFixed(4);
        const lon = dataSet.lons[index].toFixed(4);
        const arv = dataSet.ampFactors[index].toFixed(2);
        const name = meta ? meta.name : `Station ${index}`;
        const id = meta ? meta.station_id : '';
        return `<strong>${name}</strong> (${id})<br/>Lat: ${lat}°, Lon: ${lon}°<br/>Surface ARV: ${arv}`;
    }
}
