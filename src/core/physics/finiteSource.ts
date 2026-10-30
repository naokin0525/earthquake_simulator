const RUPTURE_AREA_LOG_INTERCEPT = -3.49;
const RUPTURE_AREA_MAGNITUDE_COEFFICIENT = 0.91;

export function calculateEquivalentRuptureRadiusKm(Mw: number): number {
  const magnitude = Math.max(0, Mw);
  if (magnitude < 5) return 0;

  const ruptureAreaKm2 = Math.pow(
    10,
    RUPTURE_AREA_LOG_INTERCEPT + RUPTURE_AREA_MAGNITUDE_COEFFICIENT * magnitude
  );
  return Math.sqrt(ruptureAreaKm2 / Math.PI);
}

export function calculateFiniteRuptureDistance(
  sourceDistanceKm: number,
  depthKm: number,
  Mw: number
): number {
  const distance = Math.max(0, sourceDistanceKm);
  const depth = Math.max(0, depthKm);
  const ruptureRadius = calculateEquivalentRuptureRadiusKm(Mw);
  if (ruptureRadius === 0 || distance <= depth) return distance;

  const epicentralDistance = Math.sqrt(distance * distance - depth * depth);
  return Math.hypot(Math.max(0, epicentralDistance - ruptureRadius), depth);
}
