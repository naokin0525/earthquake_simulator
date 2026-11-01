/**
 * Geodesic distance and interpolated JMA seismic travel-time tables.
 */

import { EarthquakeHypocenter } from '../types';
import tableJson from './jmaTravelTimeTables.json?raw';

const EARTH_RADIUS_KM = 6371.0088;

interface Jma2001Table {
  depthsKm: number[];
  distancesKm: number[];
  pTimesSec: number[];
  sTimesSec: number[];
}

interface Jma2020Table {
  sourceDepthStepKm: number;
  distancesKm: number[];
  pAndSTimesSec: number[][];
}

const tables = JSON.parse(tableJson) as {
  jma2001: Jma2001Table;
  jma2020a: Jma2020Table;
};
const jma2001 = tables.jma2001;
const jma2020a = tables.jma2020a;

export type SeismicPhase = 'P' | 'S';

/**
 * Computes epicentral geodesic distance in kilometers using a spherical Earth
 * with the IUGG mean radius.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = Math.PI / 180.0;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2.0) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
    Math.sin(dLon / 2.0) ** 2;
  return EARTH_RADIUS_KM * 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
}

export function hypocentralDistance(epicentralDistKm: number, depthKm: number): number {
  return Math.sqrt(epicentralDistKm * epicentralDistKm + depthKm * depthKm);
}

function findInterval(axis: number[], value: number, clampToAxis: boolean): [number, number, number] {
  const sample = clampToAxis
    ? Math.max(axis[0], Math.min(axis[axis.length - 1], value))
    : value;
  let low = 0;
  let high = axis.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (axis[middle] <= sample) low = middle;
    else high = middle;
  }
  const fraction = (sample - axis[low]) / (axis[high] - axis[low]);
  return [low, high, fraction];
}

function interpolateJma2001(depthKm: number, distanceKm: number, phase: SeismicPhase): number {
  const [depthLow, depthHigh, depthFraction] = findInterval(jma2001.depthsKm, depthKm, true);
  const [distanceLow, distanceHigh, distanceFraction] = findInterval(jma2001.distancesKm, distanceKm, false);
  const values = phase === 'P' ? jma2001.pTimesSec : jma2001.sTimesSec;
  const columnCount = jma2001.distancesKm.length;
  const at = (depthIndex: number, distanceIndex: number): number =>
    values[depthIndex * columnCount + distanceIndex];
  const top = at(depthLow, distanceLow) +
    (at(depthLow, distanceHigh) - at(depthLow, distanceLow)) * distanceFraction;
  const bottom = at(depthHigh, distanceLow) +
    (at(depthHigh, distanceHigh) - at(depthHigh, distanceLow)) * distanceFraction;
  return top + (bottom - top) * depthFraction;
}

function interpolateJma2020a(depthKm: number, distanceKm: number, phase: SeismicPhase): number {
  const depthIndex = Math.max(0, Math.min(
    jma2020a.pAndSTimesSec.length - 1,
    depthKm / jma2020a.sourceDepthStepKm
  ));
  const [depthLow, depthHigh, depthFraction] = [
    Math.floor(depthIndex),
    Math.ceil(depthIndex),
    depthIndex - Math.floor(depthIndex)
  ];
  const [distanceLow, distanceHigh, distanceFraction] =
    findInterval(jma2020a.distancesKm, distanceKm, false);
  const phaseIndex = phase === 'P' ? 0 : 1;
  const at = (sourceDepthIndex: number, distanceIndex: number): number =>
    jma2020a.pAndSTimesSec[sourceDepthIndex][distanceIndex * 2 + phaseIndex];
  const top = at(depthLow, distanceLow) +
    (at(depthLow, distanceHigh) - at(depthLow, distanceLow)) * distanceFraction;
  const bottom = at(depthHigh, distanceLow) +
    (at(depthHigh, distanceHigh) - at(depthHigh, distanceLow)) * distanceFraction;
  return top + (bottom - top) * depthFraction;
}

/**
 * Interpolates the supplied JMA2020a shallow-source table (0-8 km), or the
 * JMA2001 table for deeper sources. Distances beyond the table are linearly
 * extrapolated from its last interval; depth is bounded to the table range.
 */
export function computeTravelTimeAtDistance(
  sourceDepthKm: number,
  epicentralDistanceKm: number,
  phase: SeismicPhase
): number {
  const depth = Math.max(0, sourceDepthKm);
  const distance = Math.max(0, epicentralDistanceKm);
  if (depth <= 8) return interpolateJma2020a(depth, distance, phase);
  return interpolateJma2001(depth, distance, phase);
}

export function computeWavefrontRadiusKm(
  elapsedTimeSec: number,
  sourceDepthKm: number,
  phase: SeismicPhase
): number {
  if (elapsedTimeSec <= 0) return 0;

  const timeAt = (distanceKm: number): number =>
    computeTravelTimeAtDistance(sourceDepthKm, distanceKm, phase);
  if (elapsedTimeSec <= timeAt(0)) return 0;

  let low = 0;
  let high = Math.max(2000, elapsedTimeSec * 10 + sourceDepthKm);
  while (timeAt(high) < elapsedTimeSec) high *= 2;
  for (let iteration = 0; iteration < 40; iteration++) {
    const middle = (low + high) / 2;
    if (timeAt(middle) < elapsedTimeSec) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

export interface TravelTimeResult {
  epicentralDistance: number;
  hypocentralDistance: number;
  pArrivalTime: number;
  sArrivalTime: number;
  vP: number;
  vS: number;
}

/**
 * Computes station arrivals from the same JMA travel-time tables used by the
 * inverse solver and map isochrones. `rSlab` remains accepted for API
 * compatibility but does not alter travel times.
 */
export function computeTravelTimes(
  hypocenter: EarthquakeHypocenter,
  stationLat: number,
  stationLon: number,
  rSlab = 0
): TravelTimeResult {
  void rSlab;
  const delta = haversineDistance(hypocenter.lat, hypocenter.lon, stationLat, stationLon);
  const distance = hypocentralDistance(delta, hypocenter.depth);
  const pTime = computeTravelTimeAtDistance(hypocenter.depth, delta, 'P');
  const sTime = computeTravelTimeAtDistance(hypocenter.depth, delta, 'S');
  return {
    epicentralDistance: delta,
    hypocentralDistance: distance,
    pArrivalTime: hypocenter.originTime + pTime,
    sArrivalTime: hypocenter.originTime + sTime,
    vP: pTime > 0 ? distance / pTime : 0,
    vS: sTime > 0 ? distance / sTime : 0
  };
}
