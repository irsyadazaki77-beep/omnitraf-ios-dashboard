/**
 * OmniTRAF Surabaya - Detection Engine (Phase 7 Architecture)
 * Bertanggung jawab terhadap:
 * - Ingest & validasi boundary raw frame detections
 * - Ekstraksi deteksi canonical
 * - Provenance tagging (SIMULATED, LIVE, STALE, OFFLINE)
 * - Mencegah mutasi DOM dan canvas rendering di layer detection
 */

export const SUPPORTED_CLASSES = Object.freeze([
  'car',
  'bus',
  'truck',
  'motorcycle',
  'ambulance',
  'person'
]);

export class DetectionEngine {
  /**
   * Parse dan validasi detection objects dari payload.
   * Mengabaikan item yang malformed atau koordinat di luar batas finite normal.
   * @param {Array} rawDetections Array objek deteksi mentah
   * @param {Object} options Opsi normalisasi
   * @returns {Array} Array deteksi terverifikasi dan ternormalisasi
   */
  process(rawDetections, options = {}) {
    if (!Array.isArray(rawDetections)) return [];

    const defaultProvenance = options.provenance || 'SIMULATED';
    const processed = [];

    for (let i = 0; i < rawDetections.length; i++) {
      const d = rawDetections[i];
      if (!d || typeof d !== 'object') continue;

      // Extract geometry and coordinates
      const x = Number(d.x ?? d.boundingBox?.x);
      const y = Number(d.y ?? d.boundingBox?.y);
      const w = Number(d.w ?? d.width ?? d.boundingBox?.w);
      const h = Number(d.h ?? d.height ?? d.boundingBox?.h);

      // Validate numeric sanity (no NaN, Infinity, negative, or completely unbound coordinates)
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) {
        continue;
      }
      if (w <= 0 || h <= 0) continue;

      // Normalize bounded coordinates (0.0 .. 1.0)
      const clampedX = Math.max(0.0, Math.min(1.0, x));
      const clampedY = Math.max(0.0, Math.min(1.0, y));
      const clampedW = Math.max(0.001, Math.min(1.0 - clampedX, w));
      const clampedH = Math.max(0.001, Math.min(1.0 - clampedY, h));

      // Class normalization
      const rawClass = String(d.class || 'car').toLowerCase().trim();
      const detectionClass = SUPPORTED_CLASSES.includes(rawClass) ? rawClass : 'car';

      // Confidence normalization (0 .. 100 integer)
      const rawConf = Number(d.confidence);
      let confidence = 90;
      if (Number.isFinite(rawConf)) {
        // If passed as 0..1 float, convert to 0..100
        confidence = rawConf <= 1.0 && rawConf > 0 ? Math.round(rawConf * 100) : Math.round(rawConf);
        confidence = Math.max(0, Math.min(100, confidence));
      }

      // Track ID and Detection ID
      const trackId = String(d.trackId || d.id || `track-${i}`);
      const id = String(d.id || trackId);

      // Speed in km/h
      const rawSpeed = Number(d.speedKmh);
      const speedKmh = Number.isFinite(rawSpeed) && rawSpeed >= 0 ? Math.round(rawSpeed) : 40;

      processed.push({
        id,
        trackId,
        class: detectionClass,
        confidence,
        x: clampedX,
        y: clampedY,
        w: clampedW,
        h: clampedH,
        speedKmh,
        provenance: d.provenance || defaultProvenance
      });
    }

    return processed;
  }
}

export const detectionEngine = new DetectionEngine();
