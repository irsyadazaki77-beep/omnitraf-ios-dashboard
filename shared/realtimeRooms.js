/** Shared Socket.io room names used by the browser and server adapters. */
export const REALTIME_ROOMS = Object.freeze({
  GLOBAL: 'global',
  DASHBOARD: 'room:dashboard',
  TRAFFIC: 'room:traffic',
  SIGNALS: 'room:signals',
  INCIDENTS: 'room:incidents',
  EMERGENCY: 'room:emergency',
  DEVICES: 'room:devices',
  AUDIT: 'room:audit',
  ADMIN: 'room:admin',
  ANALYTICS: 'room:analytics',
  CCTV_ALL: 'room:cctv:all',
  cctvCamera: (camId) => `room:cctv:${camId}`
});
