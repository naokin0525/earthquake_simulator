import { describe, expect, it } from 'vitest';
import {
  computeTravelTimeAtDistance,
  computeTravelTimes,
  computeWavefrontRadiusKm
} from '../../src/core/physics/travelTime';

describe('JMA travel-time tables', () => {
  it('uses the same tabulated P/S arrival times for stations and wavefronts', () => {
    const hypocenter = {
      lat: 35,
      lon: 139,
      depth: 20,
      magnitude: 6,
      originTime: 12
    };
    const station = { lat: 35, lon: 139.2 };
    const travelTimes = computeTravelTimes(hypocenter, station.lat, station.lon);

    expect(travelTimes.pArrivalTime - hypocenter.originTime).toBeCloseTo(
      computeTravelTimeAtDistance(hypocenter.depth, travelTimes.epicentralDistance, 'P'),
      10
    );
    expect(travelTimes.sArrivalTime - hypocenter.originTime).toBeCloseTo(
      computeTravelTimeAtDistance(hypocenter.depth, travelTimes.epicentralDistance, 'S'),
      10
    );
    expect(
      computeWavefrontRadiusKm(travelTimes.pArrivalTime - hypocenter.originTime, hypocenter.depth, 'P')
    ).toBeCloseTo(travelTimes.epicentralDistance, 4);
  });

  it('does not apply the former slab-fraction velocity multiplier', () => {
    const hypocenter = {
      lat: 35,
      lon: 139,
      depth: 120,
      magnitude: 6,
      originTime: 0
    };
    const withoutSlab = computeTravelTimes(hypocenter, 36, 140);
    const withSlab = computeTravelTimes(hypocenter, 36, 140, 1);
    expect(withSlab.pArrivalTime).toBe(withoutSlab.pArrivalTime);
    expect(withSlab.sArrivalTime).toBe(withoutSlab.sArrivalTime);
  });
});
