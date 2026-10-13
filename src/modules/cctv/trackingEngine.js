/**
 * OmniTRAF Surabaya - CCTV Tracking Engine (Phase 1 & Phase 7 Refactor)
 * Bertanggung jawab khusus untuk lifecycle track simulasi:
 * creation, update, retention, expiry, ID stability, dan GC-friendly object pooling.
 */

export class TrackingEngine {
  constructor() {
    this.trackedBoxes = new Map();
    this.boxPool = []; // Reusable object pool to prevent garbage collection spikes
  }

  /**
   * Menerima target bounding box baru dari pipeline data terstruktur
   * dan mencatat target koordinat untuk diinterpolasi secara mulus di loop render 60 FPS.
   * @param {Array} boxes Bounding boxes YOLOv8
   */
  updateBoxes(boxes) {
    const incomingList = Array.isArray(boxes) ? boxes : [];
    const activeIds = new Set();
    const alpha = 0.35; // Smoothing factor untuk tracking & confidence

    for (let i = 0; i < incomingList.length; i++) {
      const box = incomingList[i];
      const boxId = box.trackId || box.id || `box-${i}`;
      activeIds.add(boxId);

      const existing = this.trackedBoxes.get(boxId);
      if (existing) {
        // Smoothing bounding box target
        existing.targetX = box.x;
        existing.targetY = box.y;
        existing.targetW = box.w;
        existing.targetH = box.h;
        
        // Rolling average smoothing untuk confidence
        existing.confidence = Math.round(existing.confidence * (1 - alpha) + box.confidence * alpha);
        existing.class = box.class;
        existing.speedKmh = box.speedKmh;
        existing.accelerationMps2 = box.accelerationMps2;
        existing.lane = box.lane;
        existing.direction = box.direction;
        existing.progress = box.progress;
        existing.movement = box.movement;
        existing.braking = box.braking;
        existing.stopped = box.stopped;
        existing.signalState = box.signalState;
        existing.provenance = box.provenance || existing.provenance || 'SIMULATED';

        // Snap instan jika terjadi perpindahan sangat drastis (reset lintasan)
        if (Math.abs(existing.targetX - existing.x) > 0.4 || Math.abs(existing.targetY - existing.y) > 0.4) {
          existing.x = existing.targetX;
          existing.y = existing.targetY;
          existing.w = existing.targetW;
          existing.h = existing.targetH;
          if (existing.trail) existing.trail = []; // Reset trail on snap
        }
      } else {
        // Recycle existing object from pool or create once
        let newBox = this.boxPool.pop();
        if (!newBox) {
          newBox = {
            id: boxId,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            targetX: box.x,
            targetY: box.y,
            targetW: box.w,
            targetH: box.h,
            class: box.class,
            confidence: box.confidence,
            speedKmh: box.speedKmh,
            accelerationMps2: box.accelerationMps2,
            lane: box.lane,
            direction: box.direction,
            progress: box.progress,
            movement: box.movement,
            braking: box.braking,
            stopped: box.stopped,
            signalState: box.signalState,
            trail: [],
            localSpeedKmh: box.speedKmh || 40,
            provenance: box.provenance || 'SIMULATED'
          };
        } else {
          newBox.id = boxId;
          newBox.x = box.x;
          newBox.y = box.y;
          newBox.w = box.w;
          newBox.h = box.h;
          newBox.targetX = box.x;
          newBox.targetY = box.y;
          newBox.targetW = box.w;
          newBox.targetH = box.h;
          newBox.class = box.class;
          newBox.confidence = box.confidence;
          newBox.speedKmh = box.speedKmh;
          newBox.accelerationMps2 = box.accelerationMps2;
          newBox.lane = box.lane;
          newBox.direction = box.direction;
          newBox.progress = box.progress;
          newBox.movement = box.movement;
          newBox.braking = box.braking;
          newBox.stopped = box.stopped;
          newBox.signalState = box.signalState;
          newBox.trail = [];
          newBox.localSpeedKmh = box.speedKmh || 40;
          newBox.provenance = box.provenance || 'SIMULATED';
        }
        this.trackedBoxes.set(boxId, newBox);
      }
    }

    // Kembalikan bounding box kadaluarsa ke object pool (max pool capacity 60)
    for (const [id, box] of this.trackedBoxes.entries()) {
      if (!activeIds.has(id)) {
        this.trackedBoxes.delete(id);
        if (this.boxPool.length < 60) {
          this.boxPool.push(box);
        }
      }
    }
  }

  getTrackCount() {
    return this.trackedBoxes.size;
  }

  clear() {
    this.trackedBoxes.clear();
    this.boxPool.length = 0;
  }
}
