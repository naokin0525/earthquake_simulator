/**
 * src/core/eew/plum.js
 * ====================
 * Implementation of the PLUM (Propagation of Local Undamped Motion) method.
 * Predicts ground motion by extrapolating local observed peaks.
 */
import { haversineDistance } from '../physics/travelTime';
import { calculateContinuousJmaIntensity } from '../physics/attenuation';

export class PlumEstimator {
    /**
     * Predicts the surface intensity at a target site using the PLUM method.
     *
     * @param {Object} targetSite - { lat, lon, arv }
     * @param {Array} observations - Array of { lat, lon, measuredPgv, ampFactor }
     * @param {number} radiusKm - Search radius for local undamped motion (default 30km)
     * @returns {Object} { predictedIntensity, predictedPgvSurface }
     */
    static predictIntensity(targetSite, observations, radiusKm = 30.0) {
        if (observations.length === 0) {
            return { predictedIntensity: 0, predictedPgvSurface: 0 };
        }

        let maxPgv600 = 0;

        for (const obs of observations) {
            const dist = haversineDistance(targetSite.lat, targetSite.lon, obs.lat, obs.lon);

            if (dist <= radiusKm) {
                // Convert observed surface PGV to bedrock PGV (PGV_600)
                // PGV_surface = PGV_600 * ARV
                const pgv600 = obs.measuredPgv / Math.max(0.1, obs.ampFactor);
                if (pgv600 > maxPgv600) {
                    maxPgv600 = pgv600;
                }
            }
        }

        // Apply target site's ARV to bedrock PGV to get predicted surface PGV
        const predictedPgvSurface = maxPgv600 * targetSite.arv;
        const predictedIntensity = calculateContinuousJmaIntensity(predictedPgvSurface);

        return {
            predictedIntensity,
            predictedPgvSurface
        };
    }
}
