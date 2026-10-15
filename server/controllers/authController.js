import bcrypt from 'bcryptjs';
import { USERS_DB } from '../config/constants.js';
import { generateToken, verifyToken } from '../middlewares/auth.js';
import { createApiErrorResponse, createApiResponse, sanitizeString } from '../middlewares/errorHandler.js';
import { backendState } from '../services/stateManager.js';
import { IS_PRODUCTION, TRUST_PROXY } from '../config/env.js';
import { tokenRevocationService } from '../services/tokenRevocationService.js';
import { auditRepository } from '../repositories/auditRepository.js';

async function recordAuthEvent({ action, username, name, role, result, details = '' }) {
  const safeUsername = sanitizeString(username || 'unknown', 64) || 'unknown';
  const event = {
    operator: sanitizeString(name || safeUsername, 100) || safeUsername,
    action,
    entity: `User ${safeUsername}`,
    result,
    actorRole: role || null,
    details,
    timestamp: new Date().toISOString()
  };

  // Auth events are security records: acknowledge them only after the database
  // has committed (and, for the embedded adapter, flushed the file to disk).
  await auditRepository.insert(event, true);
  backendState.auditLogs.unshift(event);
  if (backendState.auditLogs.length > 250) backendState.auditLogs.pop();
}

function auditUnavailable(res) {
  return res.status(503).json(createApiErrorResponse(
    503,
    'AUTH_AUDIT_UNAVAILABLE',
    'Layanan autentikasi sementara tidak tersedia karena audit tidak dapat disimpan.',
    { retryable: true }
  ));
}

export async function login(req, res) {
  const { username, password } = req.body || {};
  const cleanUsername = sanitizeString(username, 64);

  if (!username || !password) {
    try {
      await recordAuthEvent({
        action: 'AUTH_LOGIN',
        username: cleanUsername,
        result: 'FAILURE (MISSING_CREDENTIALS)',
        details: 'Login ditolak: kredensial tidak lengkap.'
      });
    } catch (error) {
      console.error('[AuthController] Login audit persistence failed.', error.code || error.message);
      return auditUnavailable(res);
    }
    return res.status(400).json(createApiErrorResponse(
      400,
      'VALIDATION_ERROR',
      'Username dan password wajib diisi.',
      { fields: { username: !username ? 'REQUIRED' : 'OK', password: !password ? 'REQUIRED' : 'OK' } }
    ));
  }

  const user = USERS_DB.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
  const isMatch = user ? await bcrypt.compare(password, user.passwordHash) : false;
  if (!isMatch) {
    try {
      await recordAuthEvent({
        action: 'AUTH_LOGIN',
        username: cleanUsername,
        name: user?.name,
        role: user?.role,
        result: 'FAILURE (INVALID_CREDENTIALS)',
        details: 'Login ditolak: kredensial tidak valid.'
      });
    } catch (error) {
      console.error('[AuthController] Login audit persistence failed.', error.code || error.message);
      return auditUnavailable(res);
    }
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

  // Persist the success event before issuing a usable session.
  try {
    await recordAuthEvent({
      action: 'AUTH_LOGIN',
      username: user.username,
      name: user.name,
      role: user.role,
      result: `SUCCESS (Role: ${user.role})`
    });
  } catch (error) {
    console.error('[AuthController] Login audit persistence failed.', error.code || error.message);
    return auditUnavailable(res);
  }

  // Set secure, HttpOnly, SameSite session cookie
  const cookieOptions = {
    httpOnly: true,
    secure: IS_PRODUCTION || req.secure || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https'),
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  };
  res.cookie('omnitraf_session', token, cookieOptions);

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

export async function logout(req, res) {
  // Extract token from cookie or Authorization header to identify actor for audit
  let token = req.cookies?.omnitraf_session || null;
  if (!token && req.headers?.authorization && /^Bearer\s+/i.test(req.headers.authorization)) {
    token = req.headers.authorization.replace(/^Bearer\s+/i, '').trim();
  }
  const principal = token ? verifyToken(token) : null;

  // Revoke token server-side so it cannot be used again
  if (token) {
    await tokenRevocationService.revokeToken(token);
  }

  // Disconnect any active Socket.IO connection associated with this revoked token or user
  if (backendState.io) {
    try {
      if (principal?.id) {
        backendState.io.to(`user:${principal.id}`).emit('auth:revoked', { message: 'Sesi telah diakhiri (logout).' });
        backendState.io.in(`user:${principal.id}`).disconnectSockets(true);
      }
    } catch (sockErr) {
      console.warn('[AuthController] Error disconnecting revoked sockets:', sockErr.message);
    }
  }

  // Clear session cookie
  res.clearCookie('omnitraf_session', {
    httpOnly: true,
    secure: IS_PRODUCTION || req.secure || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https'),
    sameSite: 'lax',
    path: '/'
  });

  if (principal) {
    try {
      await recordAuthEvent({
        action: 'AUTH_LOGOUT',
        username: principal.username,
        name: principal.name,
        role: principal.role,
        result: `SUCCESS (Role: ${principal.role})`
      });
    } catch (error) {
      // Logout must remain effective even when the audit database is degraded.
      console.error('[AuthController] Logout audit persistence failed after session revocation.', error.code || error.message);
    }
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
