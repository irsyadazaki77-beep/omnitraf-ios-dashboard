/**
 * OmniTRAF Realtime Channel Taxonomy & Event Constants
 * 
 * Strict separation of domain rooms to eliminate broadcast amplification
 * and isolate high-frequency streams (like CCTV 300ms) from dashboard telemetry.
 */

import { REALTIME_ROOMS } from '../../shared/realtimeRooms.js';
export { REALTIME_ROOMS };

export const REALTIME_PRIORITIES = Object.freeze({
  CRITICAL: 'CRITICAL',               // Emergency, signal manual override, severe incident, command ACK
  HIGH: 'HIGH',                       // Incident lifecycle, signal transitions, device failures
  NORMAL: 'NORMAL',                   // Regular telemetry, general heartbeats, UI toasts
  HIGH_FREQUENCY_VISUAL: 'HF_VISUAL'  // CCTV object tracking & vision bounding boxes (300ms)
});

export const EVENT_PRIORITIES = REALTIME_PRIORITIES;

export const REALTIME_EVENTS = Object.freeze({
  // Snapshot & Hydration
  TRAFFIC_INIT: 'traffic:init',
  STATE_RESYNC: 'state:resync',

  // Domain Telemetry Updates
  TRAFFIC_UPDATE: 'traffic:update',
  SIGNAL_UPDATE: 'signal:update',
  INCIDENT_UPDATE: 'incident:update',
  INCIDENT_RESOLVED: 'incident:resolved',
  EMERGENCY_UPDATE: 'emergency:update',
  EMERGENCY_DISPATCH_ALERT: 'emergency:dispatch-alert',
  DEVICE_UPDATE: 'device:update',
  DEVICE_CONFIG_TRANSITION: 'device:config-transition',

  // High Frequency CCTV Streams
  CCTV_VISION_UPDATE: 'cctv:vision-update',
  CCTV_CAMERA_DETECTION: 'cctv:camera:detection',
  CCTV_CAMERA_HEALTH: 'cctv:camera:health',

  // Command & Audit
  COMMAND_ACK: 'command:ack',
  AUDIT_LOG: 'audit:log',
  SYSTEM_TOAST: 'system:toast',
  CHAOS_FAULT_INJECTED: 'chaos:fault-injected',

  // Control & Health
  HEARTBEAT_PING: 'heartbeat:ping',
  HEARTBEAT_PONG: 'heartbeat:pong'
});
