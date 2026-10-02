import bcrypt from 'bcryptjs';
import { USERS_DB } from '../config/constants.js';
import { generateToken, verifyToken } from '../middlewares/auth.js';
import { createApiErrorResponse, createApiResponse, sanitizeString } from '../middlewares/errorHandler.js';
import { backendState } from '../services/stateManager.js';
import { IS_PRODUCTION, TRUST_PROXY } from '../config/env.js';

export async function login(req, res) {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json(createApiErrorResponse(
      400,
      'VALIDATION_ERROR',
      'Username dan password wajib diisi.',
      { fields: { username: !username ? 'REQUIRED' : 'OK', password: !password ? 'REQUIRED' : 'OK' } }
    ));
  }

  const cleanUsername = sanitizeString(username, 64);
  const user = USERS_DB.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
  if (!user) {
    return res.status(401).json(createApiErrorResponse(
      401,
      'INVALID_CREDENTIALS',
      'Username atau password tidak sesuai.'
    ));
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    return res.status(401).json(createApiErrorResponse(
      401,
      'INVALID_CREDENTIALS',
      'Username atau password tidak sesuai.'
    ));
  }

  const token = generateToken(user);
  const userProfile = {
    id: user.id,
    username: user.username,
    role: user.role,
    name: user.name,
    email: user.email
  };

  // Set secure, HttpOnly, SameSite session cookie
  const cookieOptions = {
    httpOnly: true,
    secure: IS_PRODUCTION || req.secure || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https'),
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  };
  res.cookie('omnitraf_session', token, cookieOptions);

  // Catat login ke audit logs (sanitized control characters)
  backendState.auditLogs.unshift({
    operator: sanitizeString(user.name, 100),
    action: 'AUTH_LOGIN',
    entity: `User ${cleanUsername}`,
    result: `SUCCESS (Role: ${user.role})`,
    timestamp: new Date().toISOString()
  });
  if (backendState.auditLogs.length > 250) backendState.auditLogs.pop();

  res.status(200).json(createApiResponse({
    type: 'auth_login_success',
    data: {
      user: userProfile
    },
    extra: {
      user: userProfile
    }
  }));
}

export function logout(req, res) {
  // Extract token from cookie or Authorization header to identify actor for audit
  let token = req.cookies?.omnitraf_session || null;
  if (!token && req.headers?.authorization && /^Bearer\s+/i.test(req.headers.authorization)) {
    token = req.headers.authorization.replace(/^Bearer\s+/i, '').trim();
  }
  const principal = token ? verifyToken(token) : null;

  // Clear session cookie
  res.clearCookie('omnitraf_session', {
    httpOnly: true,
    secure: IS_PRODUCTION || req.secure || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https'),
    sameSite: 'lax',
    path: '/'
  });

  if (principal) {
    backendState.auditLogs.unshift({
      operator: sanitizeString(principal.name, 100),
      action: 'AUTH_LOGOUT',
      entity: `User ${sanitizeString(principal.username, 64)}`,
      result: `SUCCESS (Role: ${principal.role})`,
      timestamp: new Date().toISOString()
    });
    if (backendState.auditLogs.length > 250) backendState.auditLogs.pop();
  }

  res.status(200).json(createApiResponse({
    type: 'auth_logout_success',
    data: {
      loggedOut: true
    },
    extra: {
      message: 'Sesi pengguna berhasil diakhiri.'
    }
  }));
}

export function getCurrentUser(req, res) {
  res.status(200).json(createApiResponse({
    type: 'auth_user_profile',
    data: {
      user: req.user
    },
    extra: {
      user: req.user
    }
  }));
}
