import jwt from 'jsonwebtoken';
import { ALLOW_TEST_QUERY_TOKEN_AUTH, JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET, NODE_ENV } from '../config/env.js';
import { ROLES } from '../config/constants.js';
import { getRequiredRoles, isPublicCapability } from '../config/capabilities.js';
import { createApiErrorResponse } from './errorHandler.js';

export const ALLOWED_JWT_ALGORITHMS = Object.freeze([JWT_ALGORITHM]);

export function generateToken(user) {
  return jwt.sign({
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    email: user.email
  }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: '24h',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    subject: user.id
  });
}

export function principalFromClaims(claims) {
  if (!claims || typeof claims !== 'object' || !claims.id || claims.sub !== claims.id ||
      !claims.username || !Object.values(ROLES).includes(claims.role) ||
      typeof claims.iat !== 'number' || typeof claims.exp !== 'number') return null;
  return Object.freeze({
    id: String(claims.id),
    username: String(claims.username),
    role: claims.role,
    name: typeof claims.name === 'string' ? claims.name : String(claims.username),
    email: typeof claims.email === 'string' ? claims.email : null
  });
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const claims = jwt.verify(token, JWT_SECRET, {
      algorithms: ALLOWED_JWT_ALGORITHMS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      clockTolerance: 0
    });
    return principalFromClaims(claims);
  } catch {
    return null;
  }
}

function sendAuthError(res, status, code, message, details = undefined) {
  return res.status(status).json(createApiErrorResponse(status, code, message, details));
}

export function requireAuth(requiredRoles = [], options = {}) {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : (requiredRoles ? [requiredRoles] : []);
  const allowQueryToken = options.allowQueryToken === true && NODE_ENV === 'test' && ALLOW_TEST_QUERY_TOKEN_AUTH;

  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && /^Bearer\s+/i.test(authHeader)) {
      token = authHeader.replace(/^Bearer\s+/i, '').trim();
    } else if (allowQueryToken && typeof req.query?.token === 'string') {
      token = req.query.token.trim();
    }

    if (!token) return sendAuthError(res, 401, 'UNAUTHORIZED', 'Akses ditolak: Token autentikasi Bearer wajib disertakan.');
    const principal = verifyToken(token);
    if (!principal) return sendAuthError(res, 401, 'INVALID_TOKEN', 'Token autentikasi tidak valid atau telah kedaluwarsa.');

    if (roles.length && !roles.includes(principal.role)) {
      return sendAuthError(res, 403, 'FORBIDDEN',
        `Akses ditolak: Endpoint ini memerlukan role [${roles.join(', ')}], sedangkan role akun Anda adalah '${principal.role}'.`,
        { requiredRoles: roles, currentRole: principal.role });
    }
    req.user = principal;
    return next();
  };
}

/** Route policy adapter. Capability definitions remain the source of role rules. */
export function requireCapability(capability) {
  if (isPublicCapability(capability)) return (_req, _res, next) => next();
  return requireAuth(getRequiredRoles(capability));
}
