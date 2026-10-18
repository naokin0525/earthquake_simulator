// src/core/physics/distance.ts
// Utility functions related to distance calculations for seismic modeling.

import { haversineDistance, hypocentralDistance } from './travelTime';

/**
 * Approximate the closest distance from a station to the fault plane (R_rup).
 *
 * The full geometry of a fault plane is not modeled in this simulator. As a
 * pragmatic approximation, we use hypocentral distance as a proxy for the
 * shortest distance to the rupture. This keeps attenuation consistent with
 * the travel-time model until a finite fault plane is represented.
 *
 * @param stationLat Latitude of the observation station (degrees).
 * @param stationLon Longitude of the observation station (degrees).
 * @param hypoLat    Latitude of the earthquake hypocenter (degrees).
 * @param hypoLon    Longitude of the earthquake hypocenter (degrees).
 * @returns The distance in kilometers.
 */
export function pointSourceDistance(
  stationLat: number,
  stationLon: number,
  hypoLat: number,
  hypoLon: number,
  depthKm: number
): number {
  const epicentralDistanceKm = haversineDistance(stationLat, stationLon, hypoLat, hypoLon);
  return hypocentralDistance(epicentralDistanceKm, Math.max(0, depthKm));
}

/**
 * Compatibility alias.  Until a finite fault model is introduced, the best
 * physically consistent proxy for rupture distance is the hypocentral distance.
 */
export const closestFaultDistance = pointSourceDistance;
