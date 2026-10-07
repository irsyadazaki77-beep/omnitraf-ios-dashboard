import { createApiErrorResponse } from './errorHandler.js';
import { isIP } from 'node:net';
import { IS_TEST, TRUSTED_PROXY_IPS } from '../config/env.js';
import { OMNITRAF_RUNTIME_MODE } from '../config/env.js';
import { createHash } from 'node:crypto';
import { redisManager } from '../infrastructure/redis/redisManager.js';

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
  const normalizeIp = value => {
    if (typeof value !== 'string') return null;
    let ip = value.trim().toLowerCase();
    if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));
    if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
    return isIP(ip) ? ip : null;
  };

  const socketIp = normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress);
  const forwarded = req.headers['x-forwarded-for'];

  // Tests use synthetic forwarded addresses to seed deterministic limiter cases.
  if (IS_TEST && typeof forwarded === 'string') {
    return normalizeIp(forwarded.split(',')[0]) || socketIp || '127.0.0.1';
  }

  if (!socketIp || !TRUSTED_PROXY_IPS.has(socketIp) || typeof forwarded !== 'string') {
    return socketIp || '127.0.0.1';
  }

  // Walk from the server toward the client, trusting only explicitly listed
  // proxy peers. Stop at the first untrusted hop to ignore spoofed left entries.
  const chain = forwarded.split(',').map(normalizeIp).filter(Boolean);
  chain.push(socketIp);
  let hop = chain.length - 1;
  while (hop > 0 && TRUSTED_PROXY_IPS.has(chain[hop])) hop--;
  return chain[hop] || socketIp;
}

export function rateLimiter(options = {}) {
  const windowMs = options.windowMs || 15000;
  const maxRequests = options.max || 100;
  const keyPrefix = options.keyPrefix || 'global';

  if (OMNITRAF_RUNTIME_MODE === 'cluster') {
    return async (req, res, next) => {
      const ip = getClientIp(req);
      const digest = createHash('sha256').update(`${keyPrefix}:${ip}`).digest('hex');
      try {
        const [count, ttl] = await redisManager.incrementWindow(`omnitraf:ratelimit:http:${digest}`, windowMs);
        if (Number(count) > maxRequests) {
          const cooldownMs = Math.max(0, Number(ttl));
          res.setHeader('Retry-After', Math.ceil(cooldownMs / 1000));
          return res.status(429).json(createApiErrorResponse(429, 'TOO_MANY_REQUESTS', 'Batas frekuensi permintaan terlampaui. Silakan tunggu beberapa detik.', { cooldownMs }, 'rate_limit_exceeded'));
        }
        return next();
      } catch (_) {
        return res.status(503).json(createApiErrorResponse(503, 'CLUSTER_UNAVAILABLE', 'Shared rate limiter sementara tidak tersedia.', null, 'cluster_unavailable'));
      }
    };
  }

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
export const authSessionRateLimiter = rateLimiter({ windowMs: 60000, max: 30, keyPrefix: 'auth-session' });
export const mutationRateLimiter = rateLimiter({ windowMs: 10000, max: 60, keyPrefix: 'cmd-mutation' });
export const reportRateLimiter = rateLimiter({ windowMs: 30000, max: 15, keyPrefix: 'report-export' });
export const diagnosticRateLimiter = rateLimiter({ windowMs: 15000, max: 50, keyPrefix: 'diag-inspection' });
