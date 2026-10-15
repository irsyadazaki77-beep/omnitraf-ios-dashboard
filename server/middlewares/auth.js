import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { ALLOW_TEST_QUERY_TOKEN_AUTH, JWT_ALGORITHM, JWT_AUDIENCE, JWT_ISSUER, JWT_SECRET, NODE_ENV } from '../config/env.js';
import { ROLES, USERS_DB } from '../config/constants.js';
import { getRequiredRoles, isPublicCapability } from '../config/capabilities.js';
import { createApiErrorResponse } from './errorHandler.js';
import { tokenRevocationService } from '../services/tokenRevocationService.js';

import { randomUUID } from 'crypto';

export const ALLOWED_JWT_ALGORITHMS = Object.freeze([JWT_ALGORITHM]);

export function generateToken(user) {
  const credentialVersion = createHash('sha256').update(String(user.passwordHash || '')).digest('hex');
  return jwt.sign({
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    email: user.email,
    credentialVersion
  }, JWT_SECRET, {
    algorithm: JWT_ALGORITHM,
    expiresIn: '24h',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    subject: user.id,
    jwtid: randomUUID()
  });
}

export function principalFromClaims(claims) {
  if (!claims || typeof claims !== 'object' || !claims.id || claims.sub !== claims.id ||
      !claims.username || !Object.values(ROLES).includes(claims.role) ||
      typeof claims.iat !== 'number' || typeof claims.exp !== 'number' ||
      typeof claims.credentialVersion !== 'string') return null;
  const user = USERS_DB.find((candidate) => candidate.id === String(claims.id));
  if (!user || user.username !== String(claims.username) || user.role !== claims.role) return null;
  const credentialVersion = createHash('sha256').update(String(user.passwordHash || '')).digest('hex');
  if (claims.credentialVersion !== credentialVersion) return null;
  return Object.freeze({
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    email: user.email,
    iat: claims.iat
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
    } else if (req.cookies?.omnitraf_session && typeof req.cookies.omnitraf_session === 'string') {
      token = req.cookies.omnitraf_session.trim();
    } else if (allowQueryToken && typeof req.query?.token === 'string') {
      token = req.query.token.trim();
    }

    if (!token) return sendAuthError(res, 401, 'UNAUTHORIZED', 'Akses ditolak: Token autentikasi Bearer atau sesi terverifikasi wajib disertakan.');
    const principal = verifyToken(token);
    if (!principal) return sendAuthError(res, 401, 'INVALID_TOKEN', 'Token autentikasi tidak valid atau telah kedaluwarsa.');

    // Check server-side session revocation
    tokenRevocationService.isTokenRevoked(token, principal).then((isRevoked) => {
      if (isRevoked) {
        return sendAuthError(res, 401, 'REVOKED_TOKEN', 'Sesi telah dicabut atau diakhiri (logout). Silakan login kembali.');
      }

      if (roles.length && !roles.includes(principal.role)) {
        return sendAuthError(res, 403, 'FORBIDDEN',
          `Akses ditolak: Endpoint ini memerlukan role [${roles.join(', ')}], sedangkan role akun Anda adalah '${principal.role}'.`,
          { requiredRoles: roles, currentRole: principal.role });
      }
      req.user = principal;
      return next();
    }).catch((err) => {
      console.error('[Auth Middleware] Error checking token revocation:', err);
      return sendAuthError(res, 500, 'AUTH_INTERNAL_ERROR', 'Terjadi kesalahan saat memverifikasi sesi.');
    });
  };
}

/** Route policy adapter. Capability definitions remain the source of role rules. */
export function requireCapability(capability) {
  if (isPublicCapability(capability)) return (_req, _res, next) => next();
  return requireAuth(getRequiredRoles(capability));
}
