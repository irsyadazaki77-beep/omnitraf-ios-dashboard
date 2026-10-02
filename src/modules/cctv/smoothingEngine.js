/**
 * OmniTRAF Surabaya - Temporal Smoothing Engine (Phase 7 Architecture)
 * Mengisolasi logika interpolasi LERP / frame smoothing:
 * RAW DETECTION -> TRACK STATE -> SMOOTHED PROJECTION -> RENDERER
 * Menjaga data domain tetap immutably terpisah dari interpolasi visual rendering.
 */

export class SmoothingEngine {
  /**
   * Hitung faktor lerp berbasis delta time frame
   * @param {number} dt Delta time dalam detik
   * @param {number} speed Koefisien kecepatan konvergensi
   * @returns {number} Faktor lerp 0..1
   */
  static computeLerpFactor(dt = 0.016, speed = 12) {
    const clampedDt = Math.max(0.001, Math.min(0.1, dt));
    return 1 - Math.exp(-speed * clampedDt);
  }

  /**
   * Terapkan smoothing pada single tracked box menuju targetnya
   * @param {Object} box Objek track
   * @param {number} lerpFactor Faktor interpolasi
   * @param {number} speedRatio Rasio kecepatan lokal terhadap target kecepatan
   */
  static smoothBox(box, lerpFactor, speedRatio = 1) {
    if (!box) return;
    const factor = lerpFactor * Math.max(0, Math.min(1, speedRatio));

    box.x += (box.targetX - box.x) * factor;
    box.y += (box.targetY - box.y) * factor;
    box.w += (box.targetW - box.w) * factor;
    box.h += (box.targetH - box.h) * factor;
  }
}
