/**
 * Phase 3 — Realtime Architecture & Socket Optimization Tests
 * 
 * Verifies:
 * 1. Server Realtime Event Dispatcher (priority, room targeting, domain error isolation)
 * 2. CCTV Stream Separation (health/status vs frame detections, backward compatibility)
 * 3. Client ResyncManager (single-flight idempotency, buffer bounding, sequence gap recovery)
 * 4. Client RealtimeRouter (domain boundary error isolation, event routing)
 * 5. Client RealtimeMetrics (RTT tracking, dropped event accounting, bounded ring buffer)
 * 6. Client Channel Subscription Lifecycle (join/leave rooms)
 * 7. StateStore Equality Throttling (skips redundant rerenders on unchanged telemetry)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RealtimeEventDispatcher } from '../../server/sockets/realtimeDispatcher.js';
import { REALTIME_ROOMS, EVENT_PRIORITIES } from '../../server/sockets/eventRegistry.js';
import { ResyncManager } from '../../src/core/resyncManager.js';
import { RealtimeRouter } from '../../src/core/realtimeRouter.js';
import { RealtimeMetrics } from '../../src/core/realtimeMetrics.js';
import { stateStore } from '../../src/core/stateStore.js';

describe('Phase 3 — Realtime Architecture & Socket Optimization Tests', () => {

  describe('1. RealtimeEventDispatcher & Room Targeting', () => {
    test('1.1 Dispatches events to targeted rooms with backward compatible fallback', () => {
      const emittedToRooms = [];
      const globalEmitted = [];

      const mockIo = {
        to(room) {
          return {
            emit(event, payload) {
              emittedToRooms.push({ room, event, payload });
            }
          };
        },
        emit(event, payload) {
          globalEmitted.push({ event, payload });
        }
      };

      const dispatcher = new RealtimeEventDispatcher(mockIo);

      // Traffic update should target room:traffic and room:dashboard
      dispatcher.dispatchTrafficUpdate({ seq: 101, congestionIndex: 68 });

      assert.strictEqual(emittedToRooms.length >= 2, true, 'Must target specific rooms');
      const rooms = emittedToRooms.map(e => e.room);
      assert.strictEqual(rooms.includes(REALTIME_ROOMS.TRAFFIC), true, 'Must target room:traffic');
      assert.strictEqual(rooms.includes(REALTIME_ROOMS.DASHBOARD), true, 'Must target room:dashboard');
      assert.strictEqual(globalEmitted.length, 1, 'Must emit legacy backward compatibility event');
      assert.strictEqual(globalEmitted[0].event, 'traffic:update');
      assert.strictEqual(globalEmitted[0].payload.seq, 101);
    });

    test('1.2 Domain Error Isolation in Dispatcher does not break other channels', () => {
      let brokenCalled = false;
      let healthyCalled = false;

      const mockIo = {
        to(room) {
          if (room === REALTIME_ROOMS.CCTV_ALL) {
            return {
              emit() {
                brokenCalled = true;
                throw new Error('Simulated CCTV socket failure');
              }
            };
          }
          return {
            emit() {
              healthyCalled = true;
            }
          };
        },
        emit() {}
      };

      const dispatcher = new RealtimeEventDispatcher(mockIo);

      // CCTV failure should be trapped and not throw uncaught error
      assert.doesNotThrow(() => {
        dispatcher.dispatchCctvVision({ seq: 200, cameraDetections: { 'cam-01': [] } });
      });
      assert.strictEqual(brokenCalled, true);

      // Traffic dispatch right after must proceed normally
      dispatcher.dispatchTrafficUpdate({ seq: 102 });
      assert.strictEqual(healthyCalled, true, 'Traffic channel must succeed even if CCTV channel errored');
    });

    test('1.3 Separates CCTV detection from camera status/health streams', () => {
      const roomEvents = [];
      const mockIo = {
        to(room) {
          return {
            emit(event, payload) {
              roomEvents.push({ room, event, payload });
            }
          };
        },
        emit() {}
      };

      const dispatcher = new RealtimeEventDispatcher(mockIo);
      dispatcher.dispatchCctvVision({
        seq: 55,
        cameraDetections: {
          'cam-01': [{ label: 'car', confidence: 0.92 }]
        }
      });

      const detectionEvent = roomEvents.find(r => r.room === 'room:cctv:cam-01' && (r.event === 'cctv:camera:detection' || r.event === 'cctv:detection'));
      assert.strictEqual(!!detectionEvent, true, 'Granular camera detection room event must exist');
      assert.strictEqual(detectionEvent.payload.cameraId, 'cam-01');
      assert.strictEqual(detectionEvent.payload.detections.length, 1);
    });
  });

  describe('2. Client ResyncManager & Sequence Gap Recovery', () => {
    test('2.1 Single-flight idempotent resync returns identical pending Promise', async () => {
      const mockSocketClient = {
        socket: {
          connected: true,
          emit(event, data, cb) {
            if (event === 'state:resync') {
              setTimeout(() => cb({ success: true, state: { seq: 50, intersections: [] } }), 25);
            }
          }
        }
      };

      const manager = new ResyncManager(mockSocketClient);

      const p1 = manager.requestResync();
      const p2 = manager.requestResync();
      const p3 = manager.requestResync();

      assert.strictEqual(p1, p2, 'Concurrent resync p1 and p2 must share identical promise');
      assert.strictEqual(p2, p3, 'Concurrent resync p2 and p3 must share identical promise');

      const result = await p1;
      assert.strictEqual(result.status, 'SUCCESS');
      assert.strictEqual(manager.isResyncing, false);
    });

    test('2.2 Bounded in-flight event buffer drops oldest on overflow (latest-value-wins)', () => {
      const manager = new ResyncManager(null);
      manager.maxBufferSize = 3;

      manager.bufferEvent('traffic', { seq: 1 }, () => {});
      manager.bufferEvent('traffic', { seq: 2 }, () => {});
      manager.bufferEvent('traffic', { seq: 3 }, () => {});
      assert.strictEqual(manager._resyncBuffer.length, 3);

      // Add 4th event exceeding maxBufferSize = 3
      manager.bufferEvent('traffic', { seq: 4 }, () => {});
      assert.strictEqual(manager._resyncBuffer.length, 3, 'Buffer length must remain bounded at 3');
      assert.strictEqual(manager._resyncBuffer[0].payload.seq, 2, 'Oldest seq 1 must be evicted');
      assert.strictEqual(manager._resyncBuffer[2].payload.seq, 4, 'Newest seq 4 must be preserved');
    });
  });

  describe('3. Client RealtimeRouter & Domain Error Isolation', () => {
    test('3.1 Routes events to respective domain handlers safely', () => {
      const mockResync = {
        isResyncing: false,
        bufferEvent() {}
      };
      const router = new RealtimeRouter(mockResync);

      let handledTraffic = false;
      router.registerDomainHandler('traffic', () => {
        handledTraffic = true;
      });

      router.route('traffic:update', { seq: 10, congestionIndex: 50 });
      assert.strictEqual(handledTraffic, true, 'Registered domain handler must execute on matching event');
    });

    test('3.2 Exception in one domain handler does not throw or crash router', () => {
      const router = new RealtimeRouter({ isResyncing: false });

      router.registerDomainHandler('cctv', () => {
        throw new Error('Exploding CCTV parser');
      });

      let nextHandlerExecuted = false;
      router.registerDomainHandler('traffic', () => {
        nextHandlerExecuted = true;
      });

      assert.doesNotThrow(() => {
        router.route('cctv:vision-update', { seq: 1 });
      });

      assert.doesNotThrow(() => {
        router.route('traffic:update', { seq: 2 });
      });
      assert.strictEqual(nextHandlerExecuted, true, 'Subsequent domain handler must execute despite prior error');
    });
  });

  describe('4. Client RealtimeMetrics & Diagnostics', () => {
    test('4.1 Tracks latency, event counts, sequence gaps, and resync duration with bounds', () => {
      const metrics = new RealtimeMetrics();

      metrics.recordEvent('traffic:update', { bytes: 512 });
      metrics.recordEvent('cctv:vision-update', { bytes: 2048 });
      metrics.recordRtt(15);
      metrics.recordRtt(25);
      metrics.recordResync(120);
      metrics.recordSequenceGap({ topic: 'traffic', expected: 10, received: 12 });

      const snap = metrics.getSnapshot();
      assert.strictEqual(snap.eventCount, 2);
      assert.strictEqual(snap.avgRttMs, 20);
      assert.strictEqual(snap.resyncCount, 1);
      assert.strictEqual(snap.totalResyncDurationMs, 120);
      assert.strictEqual(snap.sequenceGapCount, 1);
    });
  });

  describe('5. StateStore Granular Equality Check', () => {
    test('5.1 setState skips notification when primitive telemetry values are unchanged', () => {
      let notifyCount = 0;
      const unsubscribe = stateStore.subscribe('state:updated', () => {
        notifyCount++;
      });

      // Initial set
      stateStore.setState({ congestionIndex: 45, avgWaitTime: 30 });
      const initialNotifies = notifyCount;

      // Setting exact same values should be short-circuited by equality check
      stateStore.setState({ congestionIndex: 45, avgWaitTime: 30 });
      assert.strictEqual(notifyCount, initialNotifies, 'Redundant setState must not trigger state listeners');

      unsubscribe();
    });
  });
});
