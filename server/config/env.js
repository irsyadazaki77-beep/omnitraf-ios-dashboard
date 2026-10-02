import 'dotenv/config';

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const IS_TEST = NODE_ENV === 'test' || typeof global.it === 'function' || typeof global.test === 'function';

export const PORT = process.env.PORT !== undefined ? parseInt(process.env.PORT, 10) : 3000;
// Keep development credentials bound to the local machine by default; production
// containers can accept the standard all-interface binding unless overridden.
export const HOST = process.env.HOST || (IS_PRODUCTION ? '0.0.0.0' : '127.0.0.1');

// Fail-safe JWT Secret: Production MUST supply a strong custom secret via process.env.JWT_SECRET
const defaultDevSecret = 'omnitraf-surabaya-jwt-secret-key-2026-secure';
if (IS_PRODUCTION) {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === defaultDevSecret || process.env.JWT_SECRET.trim().length < 32) {
    console.error('FATAL: JWT_SECRET environment variable is missing, using default development secret, or is too short (min 32 chars) in production mode.');
    process.exit(1);
  }
}

export const JWT_SECRET = process.env.JWT_SECRET || defaultDevSecret;
export const JWT_ISSUER = process.env.JWT_ISSUER || 'omnitraf-sits-surabaya';
export const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'omnitraf-api';
export const JWT_ALGORITHM = 'HS256';

// Development auto-login flag: FAIL CLOSED in production.
// Only true if explicitly set to 'true' AND NOT in production mode.
export const DEV_AUTO_LOGIN = !IS_PRODUCTION && (process.env.DEV_AUTO_LOGIN === 'true' || process.env.DEV_AUTO_LOGIN === '1');

// Query-string JWTs are disabled by default, including normal test runs.
export const ALLOW_TEST_QUERY_TOKEN_AUTH = NODE_ENV === 'test' && process.env.ALLOW_TEST_QUERY_TOKEN_AUTH === 'true';
export const REDIS_URL = process.env.REDIS_URL || null;
export const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'test' || IS_TEST;
// Exact peer IPs only; never trust a forwarded client IP merely because a
// boolean says a proxy exists. Configure the direct reverse-proxy addresses.
export const TRUSTED_PROXY_IPS = new Set((process.env.TRUSTED_PROXY_IPS || '')
  .split(',')
  .map(ip => ip.trim().toLowerCase())
  .filter(Boolean));


// Origin configuration: default strictly to localhost in non-production. Production rejects '*' wildcard.
export const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || (IS_PRODUCTION ? '' : 'http://localhost:3000,http://127.0.0.1:3000');
export const allowedOrigins = rawAllowedOrigins
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

if (IS_PRODUCTION && allowedOrigins.includes('*')) {
  console.error('FATAL: Wildcard origin (*) is strictly forbidden in production mode.');
  process.exit(1);
}

export const isOriginAllowed = (origin) => {
  // Same-origin, curl, server-to-server or non-browser client without Origin header
  if (!origin) return true;

  if (!IS_PRODUCTION && allowedOrigins.includes('*')) return true;
  if (allowedOrigins.includes(origin)) return true;

  // Stricter domain checking: only allow specific cloud preview origins if explicitly enabled in non-production
  if (!IS_PRODUCTION) {
    if (/^https:\/\/([a-z0-9-]+\.)*(google\.com|googleusercontent\.com|run\.app)$/i.test(origin)) {
      return true;
    }
  }
  return false;
};
