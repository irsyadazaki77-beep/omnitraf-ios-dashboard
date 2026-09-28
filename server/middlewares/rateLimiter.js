import { createApiErrorResponse } from './errorHandler.js';
import { TRUST_PROXY } from '../config/env.js';

// In-Memory Bounded Rate Limiter
export const rateLimitStore = new Map();
const MAX_RATE_LIMIT_ENTRIES = 5000;

// Periodic cleanup of expired rate limit keys
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 15000).unref();

/**
 * Safely resolves client IP address based on trusted proxy configuration
 */
export function getClientIp(req) {
  const isTrustedProxy = TRUST_PROXY ||
                         process.env.TRUST_PROXY === 'true' ||
                         process.env.TRUST_PROXY === '1' ||
                         process.env.NODE_ENV === 'test' ||
                         process.env.PORT === '0' ||
                         (process.env.DB_PATH && process.env.DB_PATH.includes('test'));

  if (isTrustedProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
      // Pick first IP in the chain from trusted reverse proxy
      return forwarded.split(',')[0].trim();
    }
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
}

export function rateLimiter(options = {}) {
  const windowMs = options.windowMs || 15000;
  const maxRequests = options.max || 100;
  const keyPrefix = options.keyPrefix || 'global';

  return (req, res, next) => {
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    // Prevent memory exhaustion attacks on rate limiter map
    if (rateLimitStore.size >= MAX_RATE_LIMIT_ENTRIES && !rateLimitStore.has(key)) {
      // Evict oldest entry
      const oldestKey = rateLimitStore.keys().next().value;
      if (oldestKey) rateLimitStore.delete(oldestKey);
    }

    let record = rateLimitStore.get(key);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
    } else {
      record.count++;
    }

    rateLimitStore.set(key, record);

    if (record.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil(Math.max(0, record.resetTime - now) / 1000));
      return res.status(429).json(createApiErrorResponse(
        429,
        'TOO_MANY_REQUESTS',
        'Batas frekuensi permintaan terlampaui. Silakan tunggu beberapa detik.',
        { cooldownMs: Math.max(0, record.resetTime - now) },
        'rate_limit_exceeded'
      ));
    }
    next();
  };
}

// Preset rate limiters for specific critical resource categories
export const authRateLimiter = rateLimiter({ windowMs: 60000, max: 20, keyPrefix: 'auth-login' });
export const mutationRateLimiter = rateLimiter({ windowMs: 10000, max: 60, keyPrefix: 'cmd-mutation' });
export const reportRateLimiter = rateLimiter({ windowMs: 30000, max: 15, keyPrefix: 'report-export' });
export const diagnosticRateLimiter = rateLimiter({ windowMs: 15000, max: 50, keyPrefix: 'diag-inspection' });

