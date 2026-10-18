/**
 * src/core/physics/travelTime.ts
 * ==============================
 * Geodesic distance calculation and P/S wave travel-time formulations.
 */

import { EarthquakeHypocenter } from '../types';

const EARTH_RADIUS_KM = 6371.0088;
const BASE_VP_KMS = 6.0; // Baseline P-wave velocity (km/s)
const BASE_VS_KMS = 3.5; // Baseline S-wave velocity (km/s)

/**
 * Computes epicentral geodesic distance in kilometers between two points using the Haversine formula.
 *
 * The Haversine expression converts lat/lon deltas into a central angle on the sphere, which is then
 * multiplied by Earth's mean radius to get the surface distance. This is the standard way to estimate
 * great-circle distance between two coordinates without a full geodesic library.
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

  // a = sin²(Δφ/2) + cos φ1 * cos φ2 * sin²(Δλ/2)
  // This gives the squared half-chord length for the central angle.
  const a =
    Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
    Math.sin(dLon / 2.0) * Math.sin(dLon / 2.0);

  // c = 2 * atan2(sqrt(a), sqrt(1-a))
  // Convert the central angle into an arc length on a sphere of radius 6371 km.
  const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Computes hypocentral distance R = sqrt(Delta^2 + D^2).
 *
 * For a seismic source, the shortest path to a site is not just the epicentral distance; the focal
 * depth contributes as a vertical component. This 3D distance is used in intensity and travel-time
 * calculations because it better represents the actual path length than surface distance alone.
 */
export function hypocentralDistance(epicentralDistKm: number, depthKm: number): number {
  return Math.sqrt(epicentralDistKm * epicentralDistKm + depthKm * depthKm);
}

export interface TravelTimeResult {
  epicentralDistance: number;  // Delta in km
  hypocentralDistance: number; // R in km
  pArrivalTime: number;        // Tp in seconds
  sArrivalTime: number;        // Ts in seconds
  vP: number;                  // Effective P-wave velocity in km/s
  vS: number;                  // Effective S-wave velocity in km/s
}

/**
 * Calculates theoretical P-wave and S-wave arrival times for a station given a hypocenter
 * and optional subducting slab path fraction rSlab (0.0 to 1.0).
 */
export function computeTravelTimes(
  hypocenter: EarthquakeHypocenter,
  stationLat: number,
  stationLon: number,
  rSlab: number = 0.0
): TravelTimeResult {
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
