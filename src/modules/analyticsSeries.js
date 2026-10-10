import { generateForecastSnapshot, CORRIDORS_CONFIG } from './forecastEngine.js';

export function buildAnalyticsSeries(state, corridorId = 'corridor-ayani') {
  const corridor = CORRIDORS_CONFIG.find(item => item.id === corridorId) || CORRIDORS_CONFIG[0];
  const points = Array.from({ length: 24 }, (_, hour) => {
    const forecast = generateForecastSnapshot(hour, state);
    const row = forecast.corridorBreakdown.find(item => item.corridorId === corridor.id);
    return { hour, volume: row.volume, speed: row.speed, delay: row.delaySec,
      risk: Math.round(row.volume / row.capacity * 100), capacity: row.capacity };
  });
  const totalVolume = points.reduce((sum, point) => sum + point.volume, 0);
  const peak = points.reduce((a, b) => b.volume > a.volume ? b : a);
  return { corridor, points, totalVolume, peak,
    averageSpeed: Math.round(points.reduce((sum, point) => sum + point.speed * point.volume, 0) / Math.max(1, totalVolume)) };
}
