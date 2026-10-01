/**
 * src/core/physics/travelTime.ts
 * ==============================
 * Geodesic distance calculation and P/S wave travel-time formulations.
 */
const EARTH_RADIUS_KM = 6371.0088;
const BASE_VP_KMS = 6.0; // Baseline P-wave velocity (km/s)
const BASE_VS_KMS = 3.5; // Baseline S-wave velocity (km/s)
/**
 * Computes epicentral geodesic distance in kilometers between two points using the Haversine formula.
 */
export function haversineDistance(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180.0;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a = Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0) +
        Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
            Math.sin(dLon / 2.0) * Math.sin(dLon / 2.0);
    const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
    return EARTH_RADIUS_KM * c;
}
/**
 * Computes hypocentral distance R = sqrt(Delta^2 + D^2).
 */
export function hypocentralDistance(epicentralDistKm, depthKm) {
    return Math.sqrt(epicentralDistKm * epicentralDistKm + depthKm * depthKm);
}
/**
 * Calculates theoretical P-wave and S-wave arrival times for a station given a hypocenter
 * and optional subducting slab path fraction rSlab (0.0 to 1.0).
 */
export function computeTravelTimes(hypocenter, stationLat, stationLon, rSlab = 0.0) {
    const delta = haversineDistance(hypocenter.lat, hypocenter.lon, stationLat, stationLon);
    const R = hypocentralDistance(delta, hypocenter.depth);
    const rClamped = Math.max(0.0, Math.min(1.0, rSlab));
    // Velocity boost along cold subducting slab paths
    const vP = BASE_VP_KMS * (1.0 + 0.12 * rClamped);
    const vS = BASE_VS_KMS * (1.0 + 0.12 * rClamped);
    const pArrivalTime = hypocenter.originTime + R / vP;
    const sArrivalTime = hypocenter.originTime + R / vS;
    return {
        epicentralDistance: delta,
        hypocentralDistance: R,
        pArrivalTime,
        sArrivalTime,
        vP,
        vS
    };
}
