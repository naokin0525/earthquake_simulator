/**
 * src/core/physics/arvResolver.js
 * ============================
 * Utilities for resolving Site Amplification Factors (ARV) from
 * RGB-encoded Web Mercator raster tiles.
 */

export class ArvResolver {
    /**
     * Converts geographic coordinates to Web Mercator tile coordinates and pixel offset.
     *
     * @param {number} lat - Latitude in decimal degrees
     * @param {number} lon - Longitude in decimal degrees
     * @param {number} z - Zoom level
     * @returns {Object} { x, y, px, py }
     */
    static getTileCoordinates(lat, lon, z) {
        const n = Math.pow(2, z);
        const x = Math.floor(((lon + 180) / 360) * n);

        const latRad = lat * Math.PI / 180;
        const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);

        // Calculate pixel offset within the 256x256 tile
        const px = Math.floor((((lon + 180) / 360) * n - x) * 256);
        const py = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - y) * 256);

        return { x, y, px, py };
    }

    /**
     * Decodes an RGB pixel value into an ARV float.
     * Using a standard linear encoding: ARV = R/255 * 3.0 (example scale)
     * In a real-world scenario, this would match the specific encoding of the source tiles.
     *
     * @param {Uint8ClampedArray} rgba - Pixel data [R, G, B, A]
     * @returns {number} Decoded ARV value
     */
    static decodeRgbToArv(rgba) {
        const r = rgba[0];
        const g = rgba[1];
        const b = rgba[2];

        // Placeholder decoding formula:
        // We assume the ARV is primarily encoded in the Red channel for this simulation.
        // Scale: 0.5 to 3.0
        return 0.5 + (r / 255) * 2.5;
    }

    /**
     * Samples ARV from a tile image using an offscreen canvas.
     *
     * @param {string} tileUrl - URL to the .png tile
     * @param {number} px - Pixel X
     * @param {number} py - Pixel Y
     * @returns {Promise<number>} The decoded ARV value
     */
    static async sampleArvFromTile(tileUrl, px, py) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'Anonymous';
            img.src = tileUrl;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 256;
                canvas.height = 256;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                const pixel = ctx.getImageData(px, py, 1, 1).data;
                resolve(this.decodeRgbToArv(pixel));
            };
            img.onerror = (e) => reject(new Error(`Failed to load tile: ${tileUrl}`));
        });
    }
}
