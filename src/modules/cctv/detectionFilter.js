/**
 * OmniTRAF Surabaya - Detection Filter (Phase 7 Architecture)
 * Single Source of Truth untuk filtering deteksi berdasarkan:
 * - Ambang batas keyakinan (Confidence threshold)
 * - Filtering kelas tertentu (jika diperlukan)
 * Memastikan alur: Raw Detection -> Confidence Filter -> Accepted Detection -> Tracking
 */

export class DetectionFilter {
  constructor(defaultThreshold = 85) {
    this._threshold = this.sanitizeThreshold(defaultThreshold);
  }

  get threshold() {
    return this._threshold;
  }

  setThreshold(val) {
    this._threshold = this.sanitizeThreshold(val);
    return this._threshold;
  }

  /**
   * Validasi nilai threshold: finite integer antara 0 dan 100
   * Menolak NaN, Infinity, dan tipe data tidak sah dengan safe fallback 85.
   */
  sanitizeThreshold(val) {
    if (typeof val === 'string') {
      const match = val.match(/[-+]?[0-9]*\.?[0-9]+/);
      val = match ? parseFloat(match[0]) : NaN;
    }
    const num = Number(val);
    if (!Number.isFinite(num) || Number.isNaN(num)) {
      return 85;
    }
    return Math.max(0, Math.min(100, Math.round(num)));
  }

  /**
   * Filter daftar deteksi dengan ambang batas confidence aktif
   * @param {Array} detections Daftar objek deteksi
   * @param {number} [overrideThreshold] Ambang batas opsional untuk evaluasi instan
   * @returns {Array} Deteksi yang memenuhi ambang batas
   */
  filter(detections, overrideThreshold = null) {
    if (!Array.isArray(detections)) return [];

    const activeThreshold = overrideThreshold !== null ? this.sanitizeThreshold(overrideThreshold) : this._threshold;

    return detections.filter(d => {
      if (!d) return false;
      const conf = Number(d.confidence);
      // Emergency vehicle selalu dipertahankan untuk keselamatan transportasi publik jika di atas minimum safety floor 40
      const isEmergency = d.class === 'ambulance' || d.class === 'emergency';
      if (isEmergency && conf >= 40) return true;

      return Number.isFinite(conf) && conf >= activeThreshold;
    });
  }
}

export const detectionFilter = new DetectionFilter(85);
