import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/env.js';
import { createApiErrorResponse } from './errorHandler.js';

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
    { expiresIn: '24h' }
  );
}

export function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

export function requireAuth(requiredRoles = []) {
  const roles = Array.isArray(requiredRoles) ? requiredRoles : (requiredRoles ? [requiredRoles] : []);

  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.query && req.query.token) {
      token = req.query.token;
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

    req.user = decoded;
    next();
  };
}
