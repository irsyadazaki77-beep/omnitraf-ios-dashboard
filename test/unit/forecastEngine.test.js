import { test, describe } from 'node:test';
import assert from 'node:assert';
import { calculateDiurnalIntensity, generateForecastSnapshot, ESG_CONSTANTS } from '../../src/modules/forecastEngine.js';

describe('Forecast Engine - Diurnal Traffic Intensity', () => {
  test('should always return intensity in the range [0.05, 0.98]', () => {
    // Test hours from 0 to 23.9 with small steps (0.1 hours)
    for (let hour = 0; hour < 24; hour += 0.1) {
      const intensity = calculateDiurnalIntensity(hour);
      assert.ok(
        intensity >= 0.05 && intensity <= 0.98,
        `Intensity for hour ${hour} was ${intensity}, which is out of bounds [0.05, 0.98]`
      );
    }
  });

  test('should have morning peak exactly at 07:45 (7.75)', () => {
    const peakHour = 7.75; // 07:45 WIB
    const peakIntensity = calculateDiurnalIntensity(peakHour);

    // Morning window is roughly 06:00 to 09:30 WIB
    for (let h = 6.0; h <= 9.5; h += 0.05) {
      const intensity = calculateDiurnalIntensity(h);
      assert.ok(
        peakIntensity >= intensity,
        `Morning peak at 7.75 (${peakIntensity}) should be greater than or equal to intensity at hour ${h} (${intensity})`
      );
    }
  });

  test('should have evening peak exactly at 17:30 (17.50)', () => {
    const peakHour = 17.50; // 17:30 WIB
    const peakIntensity = calculateDiurnalIntensity(peakHour);

    // Evening window is roughly 16:00 to 19:30 WIB
    for (let h = 16.0; h <= 19.5; h += 0.05) {
      const intensity = calculateDiurnalIntensity(h);
      assert.ok(
        peakIntensity >= intensity,
        `Evening peak at 17.5 (${peakIntensity}) should be greater than or equal to intensity at hour ${h} (${intensity})`
      );
    }
  });

  test('should handle edge-case hours gracefully (out of bounds inputs)', () => {
    // Negative hour should be capped to 0
    assert.strictEqual(calculateDiurnalIntensity(-5), calculateDiurnalIntensity(0));
    // Hour >= 24 should be capped/handled
    assert.strictEqual(calculateDiurnalIntensity(25), calculateDiurnalIntensity(23.99));
    // Invalid input should default to 0
    assert.strictEqual(calculateDiurnalIntensity('invalid_hour'), calculateDiurnalIntensity(0));
  });
});

describe('Forecast Engine - ESG Emissions Reduction Formula', () => {
  test('should calculate ESG CO2 reduction and fuel savings correctly according to IPCC 2006 constants', () => {
    // We will test several hours to get varying congestion, queue lengths, and volumes
    const testHours = [8, 12, 18, 22];

    for (const h of testHours) {
      const snapshot = generateForecastSnapshot(h, {});
      assert.strictEqual(snapshot.status, 'success');

      const { baseline, optimized, delta } = snapshot.scenarioComparison;
      const expectedVolume = snapshot.expectedVolume;

      // 1. Calculate Expected Idling Hours Saved
      const waitTimeBaseline = baseline.waitTimeSec;
      const waitTimeOptimized = optimized.waitTimeSec;
      const expectedIdlingHoursSaved = Number(((waitTimeBaseline - waitTimeOptimized) * expectedVolume / 3600).toFixed(1));

      // 2. Calculate Expected Fuel Saved in Liters
      const expectedFuelSavedLiters = Number((expectedIdlingHoursSaved * ESG_CONSTANTS.IDLING_FUEL_LITERS_PER_HOUR).toFixed(1));

      // 3. Calculate Expected CO2 Saved in Kg (IPCC 2006 Constant)
      const expectedCo2SavedKg = Number((expectedFuelSavedLiters * ESG_CONSTANTS.CO2_KG_PER_LITER_FUEL).toFixed(1));

      // 4. Calculate Monetary Saved in IDR
      const expectedMonetarySavedRp = Math.round(expectedFuelSavedLiters * ESG_CONSTANTS.FUEL_PRICE_RP_PER_LITER);

      // Verify that the forecast snapshot delta calculations match our expectations exactly
      assert.strictEqual(
        delta.fuelSavedLiters,
        expectedFuelSavedLiters,
        `Fuel savings at hour ${h} mismatch. Expected ${expectedFuelSavedLiters}, got ${delta.fuelSavedLiters}`
      );

      assert.strictEqual(
        delta.co2SavedKg,
        expectedCo2SavedKg,
        `CO2 savings at hour ${h} mismatch. Expected ${expectedCo2SavedKg}, got ${delta.co2SavedKg}`
      );

      assert.strictEqual(
        delta.monetarySavedRp,
        expectedMonetarySavedRp,
        `Monetary savings at hour ${h} mismatch. Expected ${expectedMonetarySavedRp}, got ${delta.monetarySavedRp}`
      );
    }
  });

  test('should scale savings proportionally with queue and delay variation', () => {
    // Compare standard scenario vs a scenario with higher volume/intensity (e.g. Chaos Mode)
    const normalSnap = generateForecastSnapshot(8, { isChaosMode: false });
    const chaosSnap = generateForecastSnapshot(8, { isChaosMode: true });

    const normalSaved = normalSnap.scenarioComparison.delta.fuelSavedLiters;
    const chaosSaved = chaosSnap.scenarioComparison.delta.fuelSavedLiters;

    // Under chaos mode, intensity is higher, volume is higher, and queue length is longer,
    // so the optimized AI recommendation should produce higher absolute savings.
    assert.ok(
      chaosSaved >= normalSaved,
      `Chaos savings (${chaosSaved} L) should be greater than or equal to normal savings (${normalSaved} L) due to higher queue duration / volume`
    );
  });
});
