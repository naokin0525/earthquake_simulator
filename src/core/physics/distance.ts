// src/core/physics/distance.ts
// Utility functions related to distance calculations for seismic modeling.

import { haversineDistance } from './travelTime';

/**
 * Approximate the closest distance from a station to the fault plane (R_rup).
 *
 * The full geometry of a fault plane is not modeled in this simulator. As a
 * pragmatic approximation, we use the epicentral (surface) distance as a proxy
 * for the shortest distance to the fault plane. This matches the original
 * implementation that used `haversineDistance` for distance‑based attenuation.
 *
 * @param stationLat Latitude of the observation station (degrees).
 * @param stationLon Longitude of the observation station (degrees).
 * @param hypoLat    Latitude of the earthquake hypocenter (degrees).
 * @param hypoLon    Longitude of the earthquake hypocenter (degrees).
 * @returns The distance in kilometers.
 */
export function closestFaultDistance(
  stationLat: number,
  stationLon: number,
  hypoLat: number,
  hypoLon: number
): number {
  // Currently the fault plane is not explicitly represented; use surface distance.
  return haversineDistance(stationLat, stationLon, hypoLat, hypoLon);
}
