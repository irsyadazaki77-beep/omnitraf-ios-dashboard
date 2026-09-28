import jwt from 'jsonwebtoken';
import { JWT_SECRET, IS_TEST } from '../config/env.js';
import { createApiErrorResponse } from './errorHandler.js';

export const ALLOWED_JWT_ALGORITHMS = ['HS256'];

export function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      email: user.email
    },
    JWT_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: '24h',
      issuer: 'omnitraf-sits-surabaya'
    }
  );
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    return jwt.verify(token, JWT_SECRET, {
      algorithms: ALLOWED_JWT_ALGORITHMS,
      issuer: 'omnitraf-sits-surabaya'
    });
  } catch (err) {
    // Fallback without issuer check for legacy or existing tokens in flight
    try {
      return jwt.verify(token, JWT_SECRET, {
        algorithms: ALLOWED_JWT_ALGORITHMS
      });
    } catch (fallbackErr) {
      return null;
    }
  }
}

export function requireAuth(requiredRoles = [], options = {}) {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : (requiredRoles ? [requiredRoles] : []);
  const allowQueryToken = options.allowQueryToken === true || IS_TEST;

  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (allowQueryToken && req.query && typeof req.query.token === 'string') {
      // Discouraged mechanism: limited to explicit flag or test environment to prevent URL leakage
      token = req.query.token.trim();
    }

    if (!token) {
      return res.status(401).json(createApiErrorResponse(
        401,
        'UNAUTHORIZED',
        'Akses ditolak: Token autentikasi Bearer wajib disertakan.',
        { hint: 'Login via POST /api/auth/login untuk mendapatkan token.' }
      ));
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json(createApiErrorResponse(
        401,
        'INVALID_TOKEN',
        'Token autentikasi tidak valid atau telah kedaluwarsa.',
        { retryable: false }
      ));
    }

    if (roles.length > 0 && !roles.includes(decoded.role)) {
      return res.status(403).json(createApiErrorResponse(
        403,
        'FORBIDDEN',
        `Akses ditolak: Endpoint ini memerlukan role [${roles.join(', ')}], sedangkan role akun Anda adalah '${decoded.role}'.`,
        { requiredRoles: roles, currentRole: decoded.role }
      ));
    }

    // Authoritative Server Context: verified principal
    req.user = {
      id: decoded.id,
      username: decoded.username,
      role: decoded.role,
      name: decoded.name,
      email: decoded.email
    };
    next();
  };
}

