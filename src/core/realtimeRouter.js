/**
 * OmniTRAF Client Realtime Router (Phase 3 Master Architecture)
 * 
 * Maps inbound socket events to domain handlers with:
 * - Error isolation: handler errors in one event cannot crash other events
 * - Resync buffering coordination via ResyncManager
 * - Metric collection via RealtimeMetrics
 * - Standardized logging and dispatching
 */

import {
  stateStore,
  createEventEnvelope,
  applyServerSnapshot,
  setConnectionLifecycle,
  updateTrafficState,
  updateCctvVisionState,
  updateIncidentState,
  updateEmergencyState,
  updateSignalState,
  updateDeviceState
} from './stateStore.js';
import { soundManager } from './soundManager.js';
import { realtimeMetrics } from './realtimeMetrics.js';

export class RealtimeRouter {
  constructor(resyncManager) {
    this.resyncManager = resyncManager;
    this._customHandlers = new Map();
  }

  setResyncManager(manager) {
    this.resyncManager = manager;
  }

  registerDomainHandler(domainOrEvent, handler) {
    if (typeof handler === 'function') {
      this._customHandlers.set(domainOrEvent, handler);
    }
  }

  route(event, data) {
    realtimeMetrics.recordEvent(event, data);

    // Check custom domain handlers first
    const domain = event.split(':')[0];
    if (this._customHandlers.has(domain)) {
      try {
        this._customHandlers.get(domain)(data, event);
      } catch (err) {
        console.error(`❌ [RealtimeRouter] Custom domain handler error for '${domain}':`, err);
      }
    }
    if (this._customHandlers.has(event)) {
      try {
        this._customHandlers.get(event)(data, event);
      } catch (err) {
        console.error(`❌ [RealtimeRouter] Custom event handler error for '${event}':`, err);
      }
    }

    try {
      switch (event) {
        case 'traffic:init':
          this._handleTrafficInit(data);
          break;

        case 'traffic:update':
          this._handleTrafficUpdate(data);
          break;

        case 'cctv:vision-update':
          this._handleCctvVisionUpdate(data);
          break;

        case 'incident:update':
          this._handleIncidentUpdate(data);
          break;

        case 'incident:resolved':
          this._handleIncidentResolved(data);
          break;

        case 'emergency:update':
          this._handleEmergencyUpdate(data);
          break;

        case 'emergency:dispatch-alert':
          this._handleEmergencyDispatchAlert(data);
          break;

        case 'signal:update':
          this._handleSignalUpdate(data);
          break;

        case 'device:update':
          this._handleDeviceUpdate(data);
          break;

        case 'device:config-transition':
          this._handleDeviceConfigTransition(data);
          break;

        case 'system:toast':
          this._handleSystemToast(data);
          break;

        default:
          // Unrouted custom events or extensions
          break;
      }
    } catch (err) {
      console.error(`❌ [RealtimeRouter] Error processing incoming event '${event}':`, err);
    }
  }

  _handleTrafficInit(data) {
    if (!data) return;
    applyServerSnapshot(data, 'server');
    setConnectionLifecycle('connected', {
      isStaleData: false,
      lastTelemetryAt: Date.now()
    });
  }

  _handleTrafficUpdate(data) {
    if (this.resyncManager?.isResyncing) {
      this.resyncManager.bufferEvent('traffic', data, () => updateTrafficState(data, 'server'));
      return;
    }
    updateTrafficState(data, 'server');
  }

  _handleCctvVisionUpdate(data) {
    if (this.resyncManager?.isResyncing) {
      this.resyncManager.bufferEvent('cctv', data, () => updateCctvVisionState(data, 'server'));
      return;
    }
    updateCctvVisionState(data, 'server');
  }

  _handleIncidentUpdate(data) {
    if (!data || !data.id) return;
    const payload = data.payload || data;
    payload.seq = data.seq || payload.seq;
    payload.timestamp = data.timestamp || payload.timestamp || Date.now();
    payload.source = data.source || payload.source || 'server';

    if (this.resyncManager?.isResyncing) {
      this.resyncManager.bufferEvent('incident', payload, () => updateIncidentState(data.id, payload, 'server'));
      return;
    }
    updateIncidentState(data.id, payload, 'server');
  }

  _handleIncidentResolved(data) {
    if (!data || !data.id) return;
    const payload = {
      seq: data.seq,
      timestamp: data.timestamp || Date.now(),
      source: data.source || 'server',
      status: 'RESOLVED',
      resolvedAt: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
      resolvedBy: data.resolvedBy || 'SITS Command Center'
    };

    if (this.resyncManager?.isResyncing) {
      this.resyncManager.bufferEvent('incident', payload, () => updateIncidentState(data.id, payload, 'server'));
      return;
    }
    updateIncidentState(data.id, payload, 'server');
  }

  _handleEmergencyUpdate(data) {
    if (!data) return;
    const payload = data.payload || data;
    payload.seq = data.seq || payload.seq;
    payload.timestamp = data.timestamp || payload.timestamp || Date.now();
    payload.source = data.source || payload.source || 'server';

    if (this.resyncManager?.isResyncing) {
      this.resyncManager.bufferEvent('emergency', payload, () => updateEmergencyState(payload, 'server'));
      return;
    }
    updateEmergencyState(payload, 'server');
  }

  _handleEmergencyDispatchAlert(data) {
    if (data && typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(`🚨 DISPATCH AUTOMATION: ${data.code || data.vehicleId} (${data.vehicle || 'Armada'}) diberikan Hak Utama.`, 'warning');
      soundManager.play('alert');
    }
  }

  _handleSignalUpdate(data) {
    if (!data || !data.nodeId) return;
    const payload = data.payload || data.signalData || data;
    payload.seq = data.seq || payload.seq;
    payload.timestamp = data.timestamp || payload.timestamp || Date.now();
    payload.source = data.source || payload.source || 'server';

    if (this.resyncManager?.isResyncing) {
      this.resyncManager.bufferEvent('signal', payload, () => updateSignalState(data.nodeId, payload, 'server'));
      return;
    }
    updateSignalState(data.nodeId, payload, 'server');
  }

  _handleDeviceUpdate(data) {
    if (!data || !data.deviceId) return;
    const payload = data.payload || data.deviceData || data;
    payload.seq = data.seq || payload.seq;
    payload.timestamp = data.timestamp || payload.timestamp || Date.now();
    payload.source = data.source || payload.source || 'server';

    if (this.resyncManager?.isResyncing) {
      this.resyncManager.bufferEvent('device', payload, () => updateDeviceState(data.deviceId, payload, 'server'));
      return;
    }
    updateDeviceState(data.deviceId, payload, 'server');
  }

  _handleDeviceConfigTransition(data) {
    if (data) {
      stateStore.publish('device:config-transition', createEventEnvelope('device:config-transition', data, 'server'));
    }
  }

  _handleSystemToast(data) {
    if (data && data.message && typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast(data.message, data.type || 'normal');
      if (data.type === 'alert' || data.type === 'danger') {
        soundManager.play('alert');
      } else {
        soundManager.play('success');
      }
    }
  }
}
