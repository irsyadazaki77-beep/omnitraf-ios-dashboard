import { test, describe } from 'node:test';
import assert from 'node:assert';
import { calculateDiurnalIntensity, generateForecastSnapshot } from '../../src/modules/forecastEngine.js';
import { compareTrafficScenarios, recommendAdaptiveSignal, simulateTrafficNetwork } from '../../src/modules/trafficModel.js';

describe('Forecast Engine - deterministic diurnal curve', () => {
  test('intensity remains in range and peaks at the configured commute hours', () => {
    for (let hour = 0; hour < 24; hour += 0.1) assert.ok(calculateDiurnalIntensity(hour) >= 0.05 && calculateDiurnalIntensity(hour) <= 0.98);
    const morning = calculateDiurnalIntensity(7.75);
    for (let hour = 6; hour <= 9.5; hour += 0.05) assert.ok(morning >= calculateDiurnalIntensity(hour));
    const evening = calculateDiurnalIntensity(17.5);
    for (let hour = 16; hour <= 19.5; hour += 0.05) assert.ok(evening >= calculateDiurnalIntensity(hour));
    assert.equal(calculateDiurnalIntensity(-5), calculateDiurnalIntensity(0));
    assert.equal(calculateDiurnalIntensity('invalid'), calculateDiurnalIntensity(0));
  });
});

describe('Aggregate traffic model and predictive scenarios', () => {
  const state = {
    timestamp: '17:00 WIB',
    simulation: { seed: 412 },
    intersections: [{ id: 'node-wonokromo', greenSplit: 35, redDuration: 25, yellowDuration: 3, vehicleDemandVehPerHour: 1100, queueVehicles: 14, opposingDemandShare: 0.64 }]
  };

  test('same state and seed produce bit-for-bit identical network metrics', () => {
    assert.deepStrictEqual(simulateTrafficNetwork(state, { hour: 17, seed: 412 }), simulateTrafficNetwork(state, { hour: 17, seed: 412 }));
  });

  test('queue conservation and metric bounds hold for corridor outputs', () => {
    const result = simulateTrafficNetwork(state, { hour: 17, seed: 412, initialQueues: { 'corridor-ayani': 20 } });
    assert.ok(Math.abs(result.queueConservationResidual) < 0.00001);
    assert.ok(result.averageSpeedKmh >= 6);
    assert.ok(result.congestionIndex >= 0 && result.congestionIndex <= 100);
    assert.ok(result.corridors.every(item => item.queueVehicles >= 0 && item.throughputVehPerHour >= 0 && item.capacityVehPerHour > 0));
  });

  test('rush, rain, incident, and emergency scenarios use common seed and produce expected impacts', () => {
    const comparison = compareTrafficScenarios(state, { hour: 17, seed: 412, horizonMinutes: 30 });
    const scenarios = comparison.scenarios;
    assert.equal(comparison.sameInitialState, true);
    assert.equal(comparison.seed, 412);
    assert.ok(scenarios.rushHour.metrics.demandVehPerHour > scenarios.normal.metrics.demandVehPerHour);
    assert.ok(scenarios.heavyRain.metrics.averageSpeedKmh < scenarios.normal.metrics.averageSpeedKmh);
    assert.ok(scenarios.majorIncident.metrics.corridors[0].capacityVehPerHour < scenarios.normal.metrics.corridors[0].capacityVehPerHour);
    assert.ok(scenarios.emergencyGreenWave.metrics.throughputVehPerHour > scenarios.normal.metrics.throughputVehPerHour);
    for (const scenario of Object.values(scenarios)) assert.ok(Math.abs(scenario.metrics.queueConservationResidual) < 0.00001);
  });

  test('adaptive signal recommendation respects green bounds and minimum approach fairness', () => {
    const result = recommendAdaptiveSignal({ id: 'node-wonokromo', greenSplit: 89, redDuration: 25, vehicleDemandVehPerHour: 1600, queueVehicles: 80, opposingDemandShare: 0.99 });
    assert.ok(result.targetGreenSec >= 15 && result.targetGreenSec <= 90);
    assert.ok(result.opposingDemandShare <= 0.7);
    const phaseShare = result.targetGreenSec / (result.targetGreenSec + 25 + 3);
    assert.ok(phaseShare >= 0.3 && phaseShare <= 0.7);
    assert.match(result.reason, /antrean/);
    assert.equal(result.safety.transition, 'pending next signal cycle; yellow/all-red timings unchanged');
  });

  test('forecast output matches modeled metrics and does not claim unevaluated confidence or ESG savings', () => {
    const forecast = generateForecastSnapshot(17, state);
    assert.equal(forecast.trafficModel.demandVehPerHour, forecast.expectedVolume);
    assert.equal(forecast.trafficModel.queueMeters, forecast.expectedQueueLength);
    assert.equal(forecast.confidence, null);
    assert.equal(forecast.scenarioResults.scenarios.normal.metrics.seed, 412);
    assert.equal(forecast.esgImpact.simulatedScenarioSavings.co2SavedKg, null);
  });
});
