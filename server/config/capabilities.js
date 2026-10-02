import { ROLES } from './constants.js';

export const PUBLIC = 'PUBLIC';

/** Central capability policy for commands and read endpoints. */
export const CAPABILITIES = {
  // Public access is limited to non-sensitive service entry points.
  'auth:login': [PUBLIC],
  'auth:logout': [PUBLIC],
  'health:liveness': [PUBLIC],

  // Viewer data access. Operational snapshots are authenticated, even when read-only.
  'state:snapshot': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'state:resync': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'traffic:read': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'devices:read': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'incidents:read': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'emergencies:read': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'forecast:read': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'identity:read': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'command:status': [ROLES.OPERATOR, ROLES.ADMIN],

  // Operational or otherwise sensitive reads.
  'audit:read': [ROLES.OPERATOR, ROLES.ADMIN],
  'device:audit:read': [ROLES.OPERATOR, ROLES.ADMIN],
  'diagnostics:read': [ROLES.OPERATOR, ROLES.ADMIN],
  'reports:read': [ROLES.OPERATOR, ROLES.ADMIN],
  'cctv:snapshot': [ROLES.OPERATOR, ROLES.ADMIN],

  // Operator Actions
  'signal:override': [ROLES.OPERATOR, ROLES.ADMIN],
  'green-split:update': [ROLES.OPERATOR, ROLES.ADMIN],
  'ai:apply-recommendation': [ROLES.OPERATOR, ROLES.ADMIN],
  'emergency:activate': [ROLES.OPERATOR, ROLES.ADMIN],
  'emergency:cancel': [ROLES.OPERATOR, ROLES.ADMIN],
  'incident:create': [ROLES.OPERATOR, ROLES.ADMIN],
  'incident:update-status': [ROLES.OPERATOR, ROLES.ADMIN],
  'incident:acknowledge': [ROLES.OPERATOR, ROLES.ADMIN],
  'incident:dispatch': [ROLES.OPERATOR, ROLES.ADMIN],
  'incident:resolve': [ROLES.OPERATOR, ROLES.ADMIN],
  'siren:mute': [ROLES.OPERATOR, ROLES.ADMIN],
  'device:ping': [ROLES.OPERATOR, ROLES.ADMIN],
  'simulation:control': [ROLES.OPERATOR, ROLES.ADMIN],

  // Admin-only actions
  'green-wave:toggle': [ROLES.ADMIN],
  'device:config': [ROLES.ADMIN],
  'device:fault': [ROLES.ADMIN],
  'chaos:toggle': [ROLES.ADMIN],
  'chaos:fault-inject': [ROLES.ADMIN],
  'chaos:fault-clear': [ROLES.ADMIN],
  'terminal:execute': [ROLES.ADMIN]
};

/** Exact REST route policy, kept beside command capabilities. */
export const ROUTE_CAPABILITIES = {
  'GET /api/state/snapshot': 'state:snapshot',
  'GET /api/state/resync': 'state:resync',
  'GET /api/stream-traffic': 'traffic:read',
  'GET /api/incidents': 'incidents:read',
  'GET /api/emergencies': 'emergencies:read',
  'GET /api/audit-logs': 'audit:read',
  'GET /api/devices/ping': 'device:ping',
  'POST /api/devices/ping': 'device:ping',
  'GET /api/devices/audit': 'device:audit:read',
  'GET /api/diagnostics/health': 'diagnostics:read',
  'GET /api/diagnostics/snapshot': 'diagnostics:read',
  'GET /api/diagnostics/events': 'diagnostics:read',
  'GET /api/diagnostics/simulation': 'diagnostics:read',
  'POST /api/diagnostics/simulation/control': 'simulation:control',
  'POST /api/diagnostics/chaos/faults/inject': 'chaos:fault-inject',
  'POST /api/diagnostics/chaos/faults/clear': 'chaos:fault-clear',
  'DELETE /api/diagnostics/chaos/faults/:faultId': 'chaos:fault-clear',
  'GET /api/reports/download': 'reports:read',
  'GET /api/prediction/v1/forecast': 'forecast:read',
  'GET /api/prediction/v1/test-cases': 'diagnostics:read',
  'POST /api/terminal/execute': 'terminal:execute',
  'POST /api/incidents': 'incident:create',
  'POST /api/incidents/create-auto': 'incident:create',
  'PATCH /api/incidents/:id/status': 'incident:update-status',
  'PATCH /api/incidents/:id/resolve': 'incident:resolve',
  'PUT /api/incidents/:id/resolve': 'incident:resolve',
  'POST /api/incidents/:id/resolve': 'incident:resolve',
  'POST /api/emergencies': 'emergency:activate',
  'DELETE /api/emergencies/:id': 'emergency:cancel',
  'POST /api/emergencies/:id/cancel': 'emergency:cancel',
  'POST /api/emergencies/cancel': 'emergency:cancel',
  'GET /api/v1/traffic/realtime': 'traffic:read',
  'GET /api/v1/signals/cycle': 'traffic:read',
  'GET /api/v1/cctv/detections': 'devices:read',
  'GET /api/v1/*': 'traffic:read',
  'GET /api/auth/me': 'identity:read',
  'POST /api/auth/logout': 'auth:logout'
};

export function isActionAuthorized(role, action) {
  const allowed = CAPABILITIES[action];
  return allowed ? (allowed.includes(PUBLIC) || allowed.includes(role)) : role === ROLES.ADMIN;
}

export function getRequiredRoles(action) {
  return CAPABILITIES[action] || [ROLES.ADMIN];
}

export function isPublicCapability(action) {
  return getRequiredRoles(action).includes(PUBLIC);
}
