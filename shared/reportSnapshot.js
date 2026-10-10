const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export function createReportSnapshot(state = {}, type = 'Snapshot sesi', timestamp = new Date().toISOString()) {
  const telemetry = state.telemetry || state;
  return {
    id: `SIM-${timestamp.replace(/\D/g, '').slice(0, 17)}`,
    type, timestamp, source: state.lastTelemetrySource || 'SIMULATED', simulationOnly: true,
    metrics: {
      volume: numeric(telemetry.vehiclesToday ?? telemetry.totalVehicles),
      waitTime: numeric(telemetry.avgWaitTime), co2Saved: numeric(telemetry.co2SavedKg),
      fuelSaved: numeric(telemetry.fuelSavedLiters),
      incidents: (state.incidents || []).filter(item => String(item.status).toUpperCase() === 'RESOLVED').length
    },
    intersections: (state.intersections || []).map(item => ({
      name: item.name || item.id || 'Simpang', status: item.status || 'Tidak tersedia',
      volume: numeric(item.traffic?.volume ?? item.traffic?.vehicleCount ?? item.volume),
      speed: numeric(item.traffic?.speed ?? item.speed), waitTime: numeric(item.waitTime ?? item.traffic?.waitTime),
      controlMode: item.signal?.controlMode || item.controlMode || 'Simulasi'
    })),
    incidents: JSON.parse(JSON.stringify(state.incidents || []))
  };
}
