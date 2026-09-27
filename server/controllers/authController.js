import bcrypt from 'bcryptjs';
import { USERS_DB } from '../config/constants.js';
import { generateToken } from '../middlewares/auth.js';
import { createApiErrorResponse, createApiResponse } from '../middlewares/errorHandler.js';
import { backendState } from '../services/stateManager.js';

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

  const user = USERS_DB.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
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

  // Catat login ke audit logs
  backendState.auditLogs.unshift({
    operator: user.name,
    action: 'AUTH_LOGIN',
    entity: `User ${user.username}`,
    result: `SUCCESS (Role: ${user.role})`,
    timestamp: new Date().toISOString()
  });

  res.status(200).json(createApiResponse({
    type: 'auth_login_success',
    data: {
      token,
      user: userProfile
    },
    extra: {
      token,
      user: userProfile
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
