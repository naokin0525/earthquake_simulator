/**
 * src/core/eew/eewInversion.ts
 * ============================
 * Real-time inverse solver for hypocenter location, origin time, and magnitude estimation
 * from triggered station P-wave arrival times.
 */
import { haversineDistance, hypocentralDistance } from '../physics/travelTime';
const VP_KMS = 6.0; // P-wave velocity used for inversion
/**
 * Performs hypocenter and magnitude inversion given triggered station observations.
 */
export function estimateHypocenterAndMagnitude(obs) {
    if (obs.length === 0) {
        return { lat: 35.0, lon: 138.0, depth: 10.0, magnitude: 4.0, originTime: 0.0 };
    }
    // --------------------------------------------------------------------------
    // Case 1: Single Station (Report #1)
    // --------------------------------------------------------------------------
    if (obs.length === 1) {
        const st = obs[0];
        const defaultDepth = 10.0;
        const estR = Math.sqrt(defaultDepth * defaultDepth);
        const estOriginTime = st.tObs - estR / VP_KMS;
        // Estimate magnitude based on initial trigger
        const estMw = 4.5;
        return {
            lat: st.lat,
            lon: st.lon,
            depth: defaultDepth,
            magnitude: estMw,
            originTime: estOriginTime
        };
    }
    // Sort observations by trigger time
    const sortedObs = [...obs].sort((a, b) => a.tObs - b.tObs);
    const st1 = sortedObs[0];
    // --------------------------------------------------------------------------
    // Case 2 & 3: Multi-Station Inversion (>= 2 Stations)
    // --------------------------------------------------------------------------
    let bestLat = st1.lat;
    let bestLon = st1.lon;
    let bestDepth = 10.0;
    let minResidualSq = Infinity;
    // Define coarse grid bounding box around triggered stations
    let minLat = 90.0, maxLat = -90.0, minLon = 180.0, maxLon = -180.0;
    for (const o of sortedObs) {
        minLat = Math.min(minLat, o.lat);
        maxLat = Math.max(maxLat, o.lat);
        minLon = Math.min(minLon, o.lon);
        maxLon = Math.max(maxLon, o.lon);
    }
    // Expand bounding box search area by 1.5 degrees
    const cMinLat = Math.max(20.0, minLat - 1.5);
    const cMaxLat = Math.min(46.0, maxLat + 1.5);
    const cMinLon = Math.max(122.0, minLon - 1.5);
    const cMaxLon = Math.min(154.0, maxLon + 1.5);
    const coarseStep = 0.2; // 0.2 degrees resolution
    const candidateDepths = [10.0, 30.0, 70.0, 150.0];
    // Stage 1: Coarse Grid Search
    for (let lat = cMinLat; lat <= cMaxLat; lat += coarseStep) {
        for (let lon = cMinLon; lon <= cMaxLon; lon += coarseStep) {
            for (const d of candidateDepths) {
                const r1 = hypocentralDistance(haversineDistance(lat, lon, st1.lat, st1.lon), d);
                let resSqSum = 0.0;
                for (let i = 1; i < sortedObs.length; i++) {
                    const sti = sortedObs[i];
                    const ri = hypocentralDistance(haversineDistance(lat, lon, sti.lat, sti.lon), d);
                    const observedDiff = sti.tObs - st1.tObs;
                    const theoreticalDiff = (ri - r1) / VP_KMS;
                    const residual = observedDiff - theoreticalDiff;
                    resSqSum += residual * residual;
                }
                if (resSqSum < minResidualSq) {
                    minResidualSq = resSqSum;
                    bestLat = lat;
                    bestLon = lon;
                    bestDepth = d;
                }
            }
        }
    }
    // Stage 2: Fine Grid Local Search (0.05 degrees resolution around best candidate)
    const fineStep = 0.05;
    const fMinLat = Math.max(20.0, bestLat - 0.4);
    const fMaxLat = Math.min(46.0, bestLat + 0.4);
    const fMinLon = Math.max(122.0, bestLon - 0.4);
    const fMaxLon = Math.min(154.0, bestLon + 0.4);
    for (let lat = fMinLat; lat <= fMaxLat; lat += fineStep) {
        for (let lon = fMinLon; lon <= fMaxLon; lon += fineStep) {
            const r1 = hypocentralDistance(haversineDistance(lat, lon, st1.lat, st1.lon), bestDepth);
            let resSqSum = 0.0;
            for (let i = 1; i < sortedObs.length; i++) {
                const sti = sortedObs[i];
                const ri = hypocentralDistance(haversineDistance(lat, lon, sti.lat, sti.lon), bestDepth);
                const observedDiff = sti.tObs - st1.tObs;
                const theoreticalDiff = (ri - r1) / VP_KMS;
                const residual = observedDiff - theoreticalDiff;
                resSqSum += residual * residual;
            }
            if (resSqSum < minResidualSq) {
                minResidualSq = resSqSum;
                bestLat = lat;
                bestLon = lon;
            }
        }
    }
    // Estimate Origin Time as mean of (tObs_i - R_i / Vp)
    let originTimeSum = 0.0;
    for (const o of sortedObs) {
        const R = hypocentralDistance(haversineDistance(bestLat, bestLon, o.lat, o.lon), bestDepth);
        originTimeSum += o.tObs - R / VP_KMS;
    }
    const estOriginTime = originTimeSum / sortedObs.length;
    // Estimate Magnitude Mw
    let estMw = 5.0;
    if (sortedObs.length >= 2) {
        let mwSum = 0.0;
        let count = 0;
        for (const o of sortedObs) {
            if (o.measuredPgv && o.measuredPgv > 0.0) {
                const R = hypocentralDistance(haversineDistance(bestLat, bestLon, o.lat, o.lon), bestDepth);
                const bedrockPgv = o.measuredPgv / Math.max(0.1, o.ampFactor);
                if (bedrockPgv > 0.0) {
                    // Invert: log10(PGV) = 0.58 * Mw + 0.0038 * D - 1.29 - log10(R + 0.0028 * 10^(0.5*Mw)) - k * R
                    // Approximate inversion: Mw = (log10(PGV) + log10(R) + 1.29) / 0.58
                    const mwEstStation = (Math.log10(bedrockPgv) + Math.log10(R) + 1.29) / 0.58;
                    mwSum += mwEstStation;
                    count++;
                }
            }
        }
        if (count > 0) {
            estMw = mwSum / count;
        }
        else {
            const maxR = hypocentralDistance(haversineDistance(bestLat, bestLon, sortedObs[sortedObs.length - 1].lat, sortedObs[sortedObs.length - 1].lon), bestDepth);
            const logR = Math.log10(maxR + 10.0);
            estMw = 2.5 * logR + 1.8;
        }
        estMw = Math.min(9.0, Math.max(3.5, estMw));
    }
    else {
        estMw = 4.8;
    }
    return {
        lat: Math.round(bestLat * 1000) / 1000,
        lon: Math.round(bestLon * 1000) / 1000,
        depth: bestDepth,
        magnitude: Math.round(estMw * 10) / 10,
        originTime: estOriginTime
    };
}
