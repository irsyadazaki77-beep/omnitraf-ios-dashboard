import { isOriginAllowed } from '../config/env.js';

/**
 * Middleware CORS untuk REST API Express
 */
export function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
}

/**
 * Middleware Header Keamanan HTTP & Content Security Policy (CSP)
 */
export function securityHeadersMiddleware(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.cartocdn.com https://*.arcgisonline.com https://server.arcgisonline.com https://*.tile.openstreetmap.org https://unpkg.com https://*.unpkg.com",
      "connect-src 'self' ws: wss: https://*.google.com https://*.run.app https://*.basemaps.cartocdn.com https://*.cartocdn.com https://*.arcgisonline.com https://server.arcgisonline.com https://*.tile.openstreetmap.org https://unpkg.com",
      "frame-ancestors 'self' https://*.google.com https://*.aistudio.google.com https://aistudio.google.com https://*.run.app https://*.googleusercontent.com http://localhost:*"
    ].join('; ')
  );
  next();
}
