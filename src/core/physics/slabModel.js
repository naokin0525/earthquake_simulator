/**
 * src/core/physics/slabModel.ts
 * ==============================
 * Lightweight geometric model for the subducting Pacific and Philippine Sea plates.
 * Calculates raypath fraction rSlab in [0.0, 1.0] inside the cold high-Q slab for deep earthquakes.
 */
/**
 * Calculates the raypath fraction rSlab (0.0 to 1.0) passing through the cold subducting slab.
 *
 * For deep earthquakes (depth >= 80 km) in Japan:
 * - Raypaths extending eastward / southeastward toward the Pacific trench travel inside the slab,
 *   exhibiting earlier arrival times and lower attenuation (Anomalous Seismic Intensity / 異常震域).
 * - Raypaths extending westward toward the Sea of Japan travel through the hot mantle wedge,
 *   exhibiting heavy attenuation.
 */
export function calculateSlabFraction(hypoLat, hypoLon, hypoDepth, stationLat, stationLon) {
    if (hypoDepth < 80.0) {
        return 0.0;
    }
    // Calculate azimuth from hypocenter to station (in radians)
    const dLat = (stationLat - hypoLat) * (Math.PI / 180.0);
    const dLon = (stationLon - hypoLon) * (Math.PI / 180.0);
    const cosMeanLat = Math.cos(((hypoLat + stationLat) / 2.0) * (Math.PI / 180.0));
    const dy = dLat;
    const dx = dLon * cosMeanLat;
    const azimuth = Math.atan2(dx, dy); // Azimuth clockwise from North (-pi to +pi)
    // Pacific Plate subducts dipping West (trench is to the East, ~90 deg to 120 deg azimuth)
    // Trench normal vector is roughly East-Southeast (azimuth ~ 100 degrees)
    const trenchNormalAzimuth = 100.0 * (Math.PI / 180.0);
    // Cosine of angle between ray azimuth and trench vector
    const alignment = Math.cos(azimuth - trenchNormalAzimuth);
    // Depth weight scaling (deeper hypocenters exhibit stronger slab path differentiation)
    const depthFactor = Math.min(1.0, (hypoDepth - 80.0) / 200.0);
    // If ray is directed toward the Pacific coast/trench (alignment > 0)
    if (alignment > 0.0) {
        const rSlab = alignment * depthFactor * 0.95;
        return Math.max(0.0, Math.min(1.0, rSlab));
    }
    return 0.0;
}
