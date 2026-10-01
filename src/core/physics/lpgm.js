/**
 * src/core/physics/lpgm.ts
 * ======================
 * Long-Period Ground Motion (LPGM) Estimation Module.
 * Calculates the response velocity spectrum (Sv) in the 1.6–7.8s period band.
 *
 * Based on empirical JMA attenuation models for large shallow earthquakes.
 */
/**
 * Estimates the Long-Period Ground Motion class for a given location.
 *
 * @param hypo The earthquake hypocenter parameters.
 * @param lat Target latitude.
 * @param lon Target longitude.
 * @returns An object containing the estimated Sv and JMA class level.
 */
export function estimateLPGM(hypo, lat, lon) {
    // LPGM is typically only significant for Mw >= 6.5 and Depth <= 100km
    if (hypo.magnitude < 6.5 || hypo.depth > 100) {
        return { sv: 0, classLevel: 0 };
    }
    // Distance calculation (approximate)
    const dist = calculateDistance(hypo.lat, hypo.lon, lat, lon);
    // Simplified empirical attenuation model for Sv (cm/s)
    // Sv(r) = C * Mw^a * exp(-b * r) / (1 + r/c)
    // These coefficients are placeholders for a real empirical model
    const C = 15.0;
    const a = 1.2;
    const b = 0.002; // distance decay
    const c = 50; // saturation distance
    const sv = C * Math.pow(hypo.magnitude, a) * Math.exp(-b * dist) / (1 + dist / c);
    let classLevel = 0;
    if (sv >= 100) {
        classLevel = 4;
    }
    else if (sv >= 50) {
        classLevel = 3;
    }
    else if (sv >= 15) {
        classLevel = 2;
    }
    else if (sv >= 5) {
        classLevel = 1;
    }
    return { sv, classLevel };
}
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
