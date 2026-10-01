/**
 * src/components/map/layers/WaveFrontLayer.ts
 * ============================================
 * Deck.gl PolygonLayer / PathLayer rendering Ground Truth P/S wave circles
 * and EEW System Estimated P/S wave circles.
 */
import { PolygonLayer } from '@deck.gl/layers';
const EARTH_RADIUS_KM = 6371.0088;
/**
 * Generates geodesic circular polygon coordinates (array of [lon, lat]).
 */
export function generateGeodesicCircle(centerLat, centerLon, radiusKm, points = 64) {
    if (radiusKm <= 0.1)
        return [];
    const coords = [];
    const radLat = centerLat * (Math.PI / 180.0);
    const radLon = centerLon * (Math.PI / 180.0);
    const dR = radiusKm / EARTH_RADIUS_KM;
    for (let i = 0; i <= points; i++) {
        const bearing = (i * 2.0 * Math.PI) / points;
        const lat = Math.asin(Math.sin(radLat) * Math.cos(dR) +
            Math.cos(radLat) * Math.sin(dR) * Math.cos(bearing));
        const lon = radLon +
            Math.atan2(Math.sin(bearing) * Math.sin(dR) * Math.cos(radLat), Math.cos(dR) - Math.sin(radLat) * Math.sin(lat));
        coords.push([lon * (180.0 / Math.PI), lat * (180.0 / Math.PI)]);
    }
    return coords;
}
export function createWaveFrontLayers(props) {
    const { trueHypocenter, pRadiusKm, sRadiusKm, eewReport, id = 'wavefront' } = props;
    const layers = [];
    // 1. Ground Truth P-Wave Ring
    if (pRadiusKm > 0.1) {
        const pPoly = generateGeodesicCircle(trueHypocenter.lat, trueHypocenter.lon, pRadiusKm);
        if (pPoly.length > 0) {
            layers.push(new PolygonLayer({
                id: `${id}-true-p`,
                data: [{ polygon: pPoly }],
                getPolygon: (d) => d.polygon,
                getFillColor: [0, 180, 216, 25], // Translucent cyan fill
                getLineColor: [0, 242, 254, 220], // Bright cyan line
                getLineWidth: 3,
                lineWidthMinPixels: 2,
                stroked: true,
                filled: true,
                pickable: false
            }));
        }
    }
    // 2. Ground Truth S-Wave Ring
    if (sRadiusKm > 0.1) {
        const sPoly = generateGeodesicCircle(trueHypocenter.lat, trueHypocenter.lon, sRadiusKm);
        if (sPoly.length > 0) {
            layers.push(new PolygonLayer({
                id: `${id}-true-s`,
                data: [{ polygon: sPoly }],
                getPolygon: (d) => d.polygon,
                getFillColor: [230, 57, 70, 45], // Translucent crimson fill
                getLineColor: [255, 8, 68, 255], // Bright crimson line
                getLineWidth: 4,
                lineWidthMinPixels: 3,
                stroked: true,
                filled: true,
                pickable: false
            }));
        }
    }
    // 3. EEW Estimated Wave Front Rings (emerges when EEW Report #1 is issued)
    if (eewReport && eewReport.estimatedHypocenter) {
        const estHypo = eewReport.estimatedHypocenter;
        const elapsedTime = Math.max(0.0, (trueHypocenter.originTime + pRadiusKm / 6.0) - estHypo.originTime);
        const estPRadius = 6.0 * Math.max(0.0, elapsedTime);
        const estSRadius = 3.5 * Math.max(0.0, elapsedTime);
        if (estPRadius > 0.1) {
            const estPPoly = generateGeodesicCircle(estHypo.lat, estHypo.lon, estPRadius);
            if (estPPoly.length > 0) {
                layers.push(new PolygonLayer({
                    id: `${id}-est-p`,
                    data: [{ polygon: estPPoly }],
                    getPolygon: (d) => d.polygon,
                    getFillColor: [114, 239, 221, 15],
                    getLineColor: [114, 239, 221, 240], // Neon aqua
                    getLineWidth: 2,
                    lineWidthMinPixels: 2,
                    stroked: true,
                    filled: true,
                    pickable: false
                }));
            }
        }
        if (estSRadius > 0.1) {
            const estSPoly = generateGeodesicCircle(estHypo.lat, estHypo.lon, estSRadius);
            if (estSPoly.length > 0) {
                layers.push(new PolygonLayer({
                    id: `${id}-est-s`,
                    data: [{ polygon: estSPoly }],
                    getPolygon: (d) => d.polygon,
                    getFillColor: [255, 158, 0, 30],
                    getLineColor: [255, 158, 0, 240], // Neon orange
                    getLineWidth: 3,
                    lineWidthMinPixels: 2,
                    stroked: true,
                    filled: true,
                    pickable: false
                }));
            }
        }
    }
    return layers;
}
