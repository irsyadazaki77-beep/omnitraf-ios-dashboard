import { generateForecastSnapshot, runForecastTestSuite } from '../../src/modules/forecastEngine.js';

export function getForecastSnapshot(hour, currentState) {
  const clampedHour = Math.max(0, Math.min(23, isNaN(hour) ? 17 : hour));
  return generateForecastSnapshot(clampedHour, currentState);
}

export function getForecastTestSuite(currentState) {
  return runForecastTestSuite(currentState);
}
