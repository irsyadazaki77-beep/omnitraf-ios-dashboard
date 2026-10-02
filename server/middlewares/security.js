import { isOriginAllowed, IS_PRODUCTION } from '../config/env.js';

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

  // Permit only the exact pinned Leaflet scripts/styles used by the page.
  // Inline event handlers remain forbidden; inline styles are still required by legacy UI templates.
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' https://unpkg.com/leaflet@1.9.4/dist/leaflet.js https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com/leaflet@1.9.4/dist/leaflet.css https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://*.cartocdn.com https://*.tile.openstreetmap.org https://unpkg.com/leaflet@1.9.4/dist/images/",
    "connect-src 'self' ws: wss: https://*.basemaps.cartocdn.com https://*.cartocdn.com https://*.tile.openstreetmap.org",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "object-src 'none'"
  ];

  res.setHeader('Content-Security-Policy', cspDirectives.join('; '));
  next();
}
