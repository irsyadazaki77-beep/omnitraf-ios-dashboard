import { ROLES } from './constants.js';

/**
 * OmniTRAF - Centralized RBAC Capabilities Matrix
 * Defines authoritative permissions for every command and action in the system.
 */
export const CAPABILITIES = {
  // Read-only Actions (All roles including VIEWER)
  'state:snapshot': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'state:resync': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'traffic:read': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'devices:read': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'incidents:read': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'emergencies:read': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'audit:read': [ROLES.VIEWER, ROLES.OPERATOR, ROLES.ADMIN],
  'cctv:snapshot': [ROLES.OPERATOR, ROLES.ADMIN],

  // Operator Actions (Operational Traffic Management)
  'signal:override': [ROLES.OPERATOR, ROLES.ADMIN],
  'green-split:update': [ROLES.OPERATOR, ROLES.ADMIN],
  'ai:apply-recommendation': [ROLES.OPERATOR, ROLES.ADMIN],
  'emergency:activate': [ROLES.OPERATOR, ROLES.ADMIN],
  'emergency:cancel': [ROLES.OPERATOR, ROLES.ADMIN],
  'incident:create': [ROLES.OPERATOR, ROLES.ADMIN],
  'incident:acknowledge': [ROLES.OPERATOR, ROLES.ADMIN],
  'incident:dispatch': [ROLES.OPERATOR, ROLES.ADMIN],
  'incident:resolve': [ROLES.OPERATOR, ROLES.ADMIN],
  'siren:mute': [ROLES.OPERATOR, ROLES.ADMIN],
  'device:ping': [ROLES.OPERATOR, ROLES.ADMIN],

  // Admin Privileged Actions (Infrastructure, Physical Device, Chaos, Terminal)
  'green-wave:toggle': [ROLES.ADMIN],
  'device:config': [ROLES.ADMIN],
  'device:fault': [ROLES.ADMIN],
  'chaos:toggle': [ROLES.ADMIN],
  'terminal:execute': [ROLES.ADMIN]
};

/**
 * Evaluates whether a role is authorized for a specific action/command
 * @param {string} role 
 * @param {string} action 
 * @returns {boolean}
 */
export function isActionAuthorized(role, action) {
  const allowed = CAPABILITIES[action];
  if (!allowed) {
    // If action is unmapped, default to strict ADMIN only
    return role === ROLES.ADMIN;
  }
  return allowed.includes(role);
}

/**
 * Gets the list of required roles for an action
 * @param {string} action 
 * @returns {string[]}
 */
export function getRequiredRoles(action) {
  return CAPABILITIES[action] || [ROLES.ADMIN];
}
