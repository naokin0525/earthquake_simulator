/**
 * src/core/eew/eewInversion.ts
 * ============================
 * Real-time inverse solver for hypocenter location, origin time, and magnitude estimation
 * from triggered station P-wave arrival times.
 */

import { EarthquakeHypocenter } from '../types';
import { haversineDistance, hypocentralDistance } from '../physics/travelTime';
import { calculateBedrockPgv } from '../physics/attenuation';

export interface TriggeredObservation {
  lat: number;
  lon: number;
  tObs: number;     // Observed P-wave trigger timestamp in seconds
  ampFactor: number;
  measuredPgv?: number;
}

const VP_KMS = 6.0; // P-wave velocity used for inversion
const MIN_LATITUDE = 20.0;
const MAX_LATITUDE = 46.0;
const MIN_LONGITUDE = 122.0;
const MAX_LONGITUDE = 154.0;
const DEPTH_CANDIDATES_KM = [5, 10, 20, 40, 70, 100, 200, 400, 600];
const PICK_HUBER_THRESHOLD_SECONDS = 0.2;
const MAX_SEARCH_OBSERVATIONS = 32;
const MAX_COARSE_CANDIDATES = 12_000;

interface SourceCandidate {
  lat: number;
  lon: number;
  depth: number;
  originTime: number;
  residual: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function evaluateCandidate(
  lat: number,
  lon: number,
  depth: number,
  observations: TriggeredObservation[]
): SourceCandidate {
  const originTimes = observations.map((observation) => {
    const epicentralDistance = haversineDistance(lat, lon, observation.lat, observation.lon);
    return observation.tObs - hypocentralDistance(epicentralDistance, depth) / VP_KMS;
  });
  const originTime = median(originTimes);
  const residual = originTimes.reduce((sum, estimate) => {
    const error = Math.abs(estimate - originTime);
    // Limit the influence of picks inconsistent with the majority of stations.
    const threshold = PICK_HUBER_THRESHOLD_SECONDS;
    return sum + (error <= threshold ? error * error : 2 * threshold * error - threshold * threshold);
  }, 0);

  return { lat, lon, depth, originTime, residual };
}

function estimateMagnitude(
  observations: TriggeredObservation[],
  lat: number,
  lon: number,
  depth: number
): number {
  const amplitudes = observations.filter(
    (observation) =>
      Number.isFinite(observation.measuredPgv) &&
      (observation.measuredPgv ?? 0) > 0 &&
      Number.isFinite(observation.ampFactor) &&
      observation.ampFactor > 0
  );
  if (amplitudes.length === 0) {
    return Math.min(9, Math.max(3.5, 2.5 * Math.log10(Math.max(10, depth)) + 3.0));
  }

  let bestMagnitude = 3.5;
  let lowestResidual = Infinity;
  for (let magnitude = 3.5; magnitude <= 9.0001; magnitude += 0.05) {
    let residual = 0;
    for (const observation of amplitudes) {
      const distance = hypocentralDistance(
        haversineDistance(lat, lon, observation.lat, observation.lon),
        depth
      );
      const observedBedrockPgv = (observation.measuredPgv ?? 0) / observation.ampFactor;
      const predictedBedrockPgv = calculateBedrockPgv(
        distance,
        depth,
        magnitude,
        lat,
        lon,
        observation.lat,
        observation.lon
      );
      const error = Math.log10(Math.max(1e-6, observedBedrockPgv)) -
        Math.log10(Math.max(1e-6, predictedBedrockPgv));
      residual += Math.min(error * error, 4);
    }
    if (residual < lowestResidual) {
      lowestResidual = residual;
      bestMagnitude = magnitude;
    }
  }

  return Math.round(bestMagnitude * 10) / 10;
}

function selectSearchObservations(observations: TriggeredObservation[]): TriggeredObservation[] {
  if (observations.length <= MAX_SEARCH_OBSERVATIONS) {
    return observations;
  }

  return Array.from({ length: MAX_SEARCH_OBSERVATIONS }, (_, index) => {
    const observationIndex = Math.round(
      (index * (observations.length - 1)) / (MAX_SEARCH_OBSERVATIONS - 1)
    );
    return observations[observationIndex];
  });
}

/**
 * Performs hypocenter and magnitude inversion given triggered station observations.
 */
export function estimateHypocenterAndMagnitude(
  obs: TriggeredObservation[]
): EarthquakeHypocenter {
  const validObs = obs.filter(
    (observation) =>
      Number.isFinite(observation.lat) &&
      Number.isFinite(observation.lon) &&
      Number.isFinite(observation.tObs) &&
      observation.lat >= -90 &&
      observation.lat <= 90 &&
      observation.lon >= -180 &&
      observation.lon <= 180
  );
  if (validObs.length === 0) {
    return { lat: 35.0, lon: 138.0, depth: 10.0, magnitude: 4.0, originTime: 0.0 };
  }

  if (validObs.length === 1) {
    const st = validObs[0];
    const defaultDepth = 10.0;
    const estOriginTime = st.tObs - defaultDepth / VP_KMS;
    const estMw = estimateMagnitude(validObs, st.lat, st.lon, defaultDepth);

    return {
      lat: st.lat,
      lon: st.lon,
      depth: defaultDepth,
      magnitude: estMw,
      originTime: estOriginTime
    };
  }

  // Sort observations by trigger time
  const sortedObs = [...validObs].sort((a, b) => a.tObs - b.tObs);
  const searchObs = selectSearchObservations(sortedObs);
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
  const cMinLat = Math.max(MIN_LATITUDE, minLat - 1.5);
  const cMaxLat = Math.min(MAX_LATITUDE, maxLat + 1.5);
  const cMinLon = Math.max(MIN_LONGITUDE, minLon - 1.5);
  const cMaxLon = Math.min(MAX_LONGITUDE, maxLon + 1.5);

  let coarseStep = 0.2;
  const coarseCandidateCount = () =>
    (Math.ceil((cMaxLat - cMinLat) / coarseStep) + 1) *
    (Math.ceil((cMaxLon - cMinLon) / coarseStep) + 1) *
    DEPTH_CANDIDATES_KM.length;
  while (coarseCandidateCount() > MAX_COARSE_CANDIDATES) {
    coarseStep *= 1.25;
  }

  // Stage 1: Coarse Grid Search
  for (let lat = cMinLat; lat <= cMaxLat; lat += coarseStep) {
    for (let lon = cMinLon; lon <= cMaxLon; lon += coarseStep) {
      for (const depth of DEPTH_CANDIDATES_KM) {
        const candidate = evaluateCandidate(lat, lon, depth, searchObs);
        if (candidate.residual < minResidualSq) {
          minResidualSq = candidate.residual;
          bestLat = candidate.lat;
          bestLon = candidate.lon;
          bestDepth = candidate.depth;
        }
      }
    }
  }

  // Stage 2: Fine Grid Local Search (0.05 degrees resolution around best candidate)
  const fineStep = 0.05;
  const fineRadius = Math.max(0.4, coarseStep);
  const fMinLat = Math.max(20.0, bestLat - fineRadius);
  const fMaxLat = Math.min(46.0, bestLat + fineRadius);
  const fMinLon = Math.max(122.0, bestLon - fineRadius);
  const fMaxLon = Math.min(154.0, bestLon + fineRadius);

  for (let lat = fMinLat; lat <= fMaxLat; lat += fineStep) {
    for (let lon = fMinLon; lon <= fMaxLon; lon += fineStep) {
      for (const depth of DEPTH_CANDIDATES_KM) {
        const candidate = evaluateCandidate(lat, lon, depth, searchObs);
        if (candidate.residual < minResidualSq) {
          minResidualSq = candidate.residual;
          bestLat = candidate.lat;
          bestLon = candidate.lon;
          bestDepth = candidate.depth;
        }
      }
    }
  }

  // Refine latitude, longitude, and depth together around the best grid candidate.
  // Use every pick for this bounded local search to recover accuracy after coarse sampling.
  let latStep = 0.05;
  let lonStep = 0.05;
  let depthStep = 20;
  for (let iteration = 0; iteration < 6; iteration++) {
    let candidateBest = evaluateCandidate(bestLat, bestLon, bestDepth, sortedObs);
    for (const latOffset of [-1, 0, 1]) {
      for (const lonOffset of [-1, 0, 1]) {
        for (const depthOffset of [-1, 0, 1]) {
          const lat = bestLat + latOffset * latStep;
          const lon = bestLon + lonOffset * lonStep;
          const depth = bestDepth + depthOffset * depthStep;
          if (
            lat < MIN_LATITUDE || lat > MAX_LATITUDE ||
            lon < MIN_LONGITUDE || lon > MAX_LONGITUDE ||
            depth < 0 || depth > 700
          ) {
            continue;
          }
          const candidate = evaluateCandidate(lat, lon, depth, sortedObs);
          if (candidate.residual < candidateBest.residual) {
            candidateBest = candidate;
          }
        }
      }
    }
    bestLat = candidateBest.lat;
    bestLon = candidateBest.lon;
    bestDepth = candidateBest.depth;
    minResidualSq = candidateBest.residual;
    latStep /= 2;
    lonStep /= 2;
    depthStep /= 2;
  }

  const bestCandidate = evaluateCandidate(bestLat, bestLon, bestDepth, sortedObs);
  const estMw = estimateMagnitude(sortedObs, bestLat, bestLon, bestDepth);

  return {
    lat: Math.round(bestLat * 1000) / 1000,
    lon: Math.round(bestLon * 1000) / 1000,
    depth: bestDepth,
    magnitude: Math.round(estMw * 10) / 10,
    originTime: bestCandidate.originTime
  };
}
