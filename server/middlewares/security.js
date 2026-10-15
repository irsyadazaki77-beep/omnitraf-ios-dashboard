import { allowedOrigins, isOriginAllowed, IS_PRODUCTION } from '../config/env.js';

/**
 * Middleware CORS untuk REST API Express
 * Mengimplementasikan prinsip least privilege: Origin terdaftar di-whitelist secara eksplisit
 */
export function corsMiddleware(req, res, next) {
  const origin = req.headers.origin;

  if (origin) {
    if (isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Command-Id, X-Idempotency-Key, X-Correlation-Id');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400');
    } else {
      // Origin is explicitly disallowed
      if (req.method === 'OPTIONS') {
        return res.status(403).json({
          success: false,
          code: 'CORS_ORIGIN_REJECTED',
          message: `CORS policy violation: Origin '${origin}' is not permitted.`
        });
      }
    }
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
  // Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Privacy-preserving referrer
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Anti-clickjacking fallback
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Granular feature permissions
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self), payment=()');

  // HSTS when serving over HTTPS or behind production reverse proxy
  if (req.secure || req.headers['x-forwarded-proto'] === 'https' || IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Socket connections follow the configured application origins. Never use
  // scheme-wide ws:/wss: sources, which would authorize arbitrary hosts.
  const socketOrigins = allowedOrigins.flatMap((origin) => {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === 'https:') return [`wss://${parsed.host}`];
      if (parsed.protocol === 'http:' && !IS_PRODUCTION) return [`ws://${parsed.host}`];
    } catch {
      // Invalid origins are rejected by environment validation in production.
    }
    return [];
  });
  const connectSources = [...new Set([
    "'self'",
    ...socketOrigins
  ])];

  // Inline style blocks and attributes are both blocked. Dynamic data styling
  // is applied through CSSOM after rendering, while template styles live in
  // the local stylesheet bundle.
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self'",
    "style-src-elem 'self'",
    "style-src-attr 'none'",
    "font-src 'self' data:",
    "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://basemaps.cartocdn.com https://*.cartocdn.com https://cartocdn.com https://*.tile.openstreetmap.org https://tile.openstreetmap.org",
    `connect-src ${connectSources.join(' ')}`,
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "object-src 'none'"
  ];

  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
  next();
}
