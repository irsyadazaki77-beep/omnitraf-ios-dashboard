import 'dotenv/config';

export const PORT = process.env.PORT !== undefined ? parseInt(process.env.PORT, 10) : 3000;
export const JWT_SECRET = process.env.JWT_SECRET || 'omnitraf-surabaya-jwt-secret-key-2026-secure';
export const REDIS_URL = process.env.REDIS_URL || null;

export const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || 'http://localhost:3000';
export const allowedOrigins = rawAllowedOrigins
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

export const isOriginAllowed = (origin) => {
  if (!origin) return true; // Izinkan permintaan tanpa origin header (same-origin, curl, server-to-server)
  if (allowedOrigins.includes('*')) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Izinkan origin domain preview AI Studio & Google Cloud Run
  if (/^https:\/\/([a-z0-9-]+\.)*(google\.com|googleusercontent\.com|run\.app)$/i.test(origin)) {
    return true;
  }
  return false;
};
