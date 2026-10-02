/**
 * OmniTRAF Surabaya - CCTV Telemetry Builder (Phase 7 Architecture)
 * Memisahkan kalkulasi metrik kecerdasan buatan dari UI rendering.
 * Menghasilkan:
 * - Volume kendaraan & breakdown per kelas
 * - Estimasi rata-rata kecepatan
 * - Tingkat okupansi lajur & kepadatan
 * - Panjang antrean & estimasi risiko insiden
 */

export class TelemetryBuilder {
  /**
   * Hitung metrik telemetri lalu lintas terderivasi dari deteksi yang terverifikasi
   * @param {Array} detections Daftar objek deteksi
   * @param {boolean} isChaosMode Status chaos mode
   * @returns {Object} Derived intelligence metrics
   */
  static calculate(detections = [], isChaosMode = false) {
    const validDetections = Array.isArray(detections) ? detections : [];
    const counts = { car: 0, bus: 0, truck: 0, motorcycle: 0, ambulance: 0, person: 0 };
    let speedSum = 0;
    let confidenceSum = 0;

    for (let i = 0; i < validDetections.length; i++) {
      const d = validDetections[i];
      const cls = (d.class || 'car').toLowerCase();
      if (cls in counts) {
        counts[cls]++;
      }
      speedSum += Number.isFinite(d.speedKmh) ? d.speedKmh : 42;
      confidenceSum += Number.isFinite(d.confidence) ? d.confidence : 95;
    }

    const totalCount = counts.car + counts.bus + counts.truck + counts.motorcycle + counts.ambulance;
    const avgSpeed = totalCount > 0 ? Math.round(speedSum / totalCount) : (isChaosMode ? 8 : 45);
    const avgConfidence = validDetections.length > 0 ? Math.round(confidenceSum / validDetections.length) : 96;

    // Occupancy based on bounding box areas
    let areaSum = 0;
    for (let i = 0; i < validDetections.length; i++) {
      const d = validDetections[i];
      const w = Number(d.w) || 0;
      const h = Number(d.h) || 0;
      areaSum += w * h;
    }
    const occupancy = Math.min(100, Math.round(areaSum * 380));

    // Queue length calculation
    let queueLength = 0;
    if (totalCount > 0) {
      queueLength = Math.round(totalCount * 9 + (occupancy * 0.8));
      if (isChaosMode) queueLength += 65; // Simulated heavy congestion in chaos
    }

    // Traffic density percentage
    const density = Math.min(100, Math.round((totalCount * 12) + (occupancy * 0.4)));

    // Incident Risk rating
    let risk = Math.min(100, Math.round((density * 0.7) + (queueLength * 0.2)));
    if (counts.ambulance > 0) risk = Math.min(100, risk + 15);

    return {
      vehicleCount: totalCount,
      carCount: counts.car,
      motorcycleCount: counts.motorcycle,
      busCount: counts.bus,
      truckCount: counts.truck,
      ambulanceCount: counts.ambulance,
      personCount: counts.person,
      laneOccupancy: occupancy,
      queueLengthMeters: queueLength,
      estimatedAverageSpeed: avgSpeed,
      trafficDensity: density,
      incidentRisk: risk,
      aiConfidence: avgConfidence
    };
  }
}
