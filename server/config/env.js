import 'dotenv/config';

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';
export const IS_TEST = NODE_ENV === 'test' || typeof global.it === 'function' || typeof global.test === 'function';

export const PORT = process.env.PORT !== undefined ? parseInt(process.env.PORT, 10) : 3000;

// Fail-safe JWT Secret: Production MUST supply a strong custom secret via process.env.JWT_SECRET
const defaultDevSecret = 'omnitraf-surabaya-jwt-secret-key-2026-secure';
if (IS_PRODUCTION && (!process.env.JWT_SECRET || process.env.JWT_SECRET === defaultDevSecret)) {
  console.error('FATAL: JWT_SECRET environment variable is missing or using default development secret in production mode.');
  process.exit(1);
}

export const JWT_SECRET = process.env.JWT_SECRET || defaultDevSecret;
export const REDIS_URL = process.env.REDIS_URL || null;
export const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'test' || IS_TEST;


// Origin configuration: default strictly to localhost in non-production
export const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || (IS_PRODUCTION ? '' : 'http://localhost:3000,http://127.0.0.1:3000');
export const allowedOrigins = rawAllowedOrigins
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

export const isOriginAllowed = (origin) => {
  // Same-origin, curl, server-to-server or non-browser client without Origin header
  if (!origin) return true;

  if (allowedOrigins.includes('*')) return true;
  if (allowedOrigins.includes(origin)) return true;

  // Stricter domain checking: only allow specific cloud preview origins if explicitly enabled in non-production
  if (!IS_PRODUCTION) {
    if (/^https:\/\/([a-z0-9-]+\.)*(google\.com|googleusercontent\.com|run\.app)$/i.test(origin)) {
      return true;
    }
  }
  return false;
};

