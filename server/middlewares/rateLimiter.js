import { createApiErrorResponse } from './errorHandler.js';

// In-Memory Bounded Rate Limiter
export const rateLimitStore = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 30000).unref();

export function rateLimiter(options = {}) {
  const windowMs = options.windowMs || 15000;
  const maxRequests = options.max || 100;
  const keyPrefix = options.keyPrefix || 'global';

  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let record = rateLimitStore.get(key);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
    } else {
      record.count++;
    }

    rateLimitStore.set(key, record);

    if (record.count > maxRequests) {
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
