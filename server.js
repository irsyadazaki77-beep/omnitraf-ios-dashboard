import 'dotenv/config';

const isTest = typeof global.it === 'function' || 
               typeof global.test === 'function' || 
               process.env.NODE_ENV === 'test' || 
               (process.env.DB_PATH && process.env.DB_PATH.includes('test')) ||
               process.env.PORT === '0';

if (isTest) {
  console.log = () => {};
  console.warn = () => {};
}

import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { HOST, PORT, isOriginAllowed } from './server/config/env.js';
import { dbManager } from './server/db/database.js';
import { backendState } from './server/services/stateManager.js';
import { corsMiddleware, securityHeadersMiddleware } from './server/middlewares/security.js';
import { rateLimiter } from './server/middlewares/rateLimiter.js';
import { initializeSocketServer } from './server/sockets/socketServer.js';
import apiRoutes from './server/routes/apiRoutes.js';
import { diagnosticEngine } from './server/services/diagnosticEngine.js';
import { requireCapability } from './server/middlewares/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure persistence layer & state hydration are completed on startup
try {
  await dbManager.init();
  await backendState.init();
} catch (startupErr) {
  console.error('❌ [Server Startup] Gagal inisialisasi persistensi database:', startupErr.message);
}

const app = express();
const server = http.createServer(app);

// 1. Security & Standard Middlewares
app.use(corsMiddleware);
app.use(securityHeadersMiddleware);

// Parse session cookies before protected health routes as well as API routes.
app.use((req, res, next) => {
  req.cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader && typeof cookieHeader === 'string') {
    for (const cookie of cookieHeader.split(';')) {
      const parts = cookie.split('=');
      const name = parts[0]?.trim();
      const value = parts.slice(1).join('=').trim();
      if (!name) continue;
      try {
        req.cookies[name] = decodeURIComponent(value);
      } catch (_) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_COOKIE',
          message: 'Format cookie permintaan tidak valid.'
        });
      }
    }
  }
  next();
});

// 1b. Liveness & Readiness Endpoints
app.get('/healthz', requireCapability('health:liveness'), (req, res) => {
  res.status(200).json({
    success: true,
    type: 'health_liveness',
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

app.get('/ready', requireCapability('diagnostics:read'), (req, res) => {
  const hasActiveDbFault = diagnosticEngine.isFaultActive('database');
  const dbReady = dbManager.isInitialized && dbManager.db !== null && !hasActiveDbFault;
  let dbStatus = 'DISCONNECTED';
  if (hasActiveDbFault) {
    dbStatus = 'FAULT_INJECTED_UNAVAILABLE';
  } else if (dbReady) {
    try {
      dbManager.db.exec('SELECT 1;');
      dbStatus = 'CONNECTED';
    } catch (err) {
      dbStatus = 'DEGRADED';
    }
  }

  const clientsCount = backendState.io?.engine?.clientsCount || 0;
  const socketStatus = backendState.io ? 'CONNECTED' : 'DISCONNECTED';

  const isReady = dbStatus === 'CONNECTED' && backendState.isHydrated && !hasActiveDbFault;
  const status = isReady ? 'READY' : (hasActiveDbFault ? 'DEGRADED' : 'OUT_OF_SERVICE');
  const statusCode = isReady ? 200 : 503;

  res.status(statusCode).json({
    ready: isReady,
    success: isReady,
    type: 'health_readiness',
    status,
    health: isReady ? 'HEALTHY' : (hasActiveDbFault ? 'DEGRADED' : 'UNAVAILABLE'),
    timestamp: new Date().toISOString(),
    components: {
      database: dbStatus,
      stateHydration: backendState.isHydrated ? 'COMPLETED' : 'PENDING',
      socketServer: socketStatus,
      activeClients: clientsCount,
      process: 'RUNNING'
    },
    data: {
      status,
      components: {
        database: dbStatus,
        stateHydration: backendState.isHydrated ? 'COMPLETED' : 'PENDING',
        socketServer: socketStatus,
        activeClients: clientsCount,
        process: 'RUNNING'
      }
    },
    error: isReady ? null : {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Backend prototipe belum siap menerima trafik: dependensi database atau hidrasi state belum tuntas.'
    }
  });
});

app.use(rateLimiter({ windowMs: 15000, max: 200, keyPrefix: 'api-global' }));
app.use(express.json({ limit: '1mb' }));

// Reject browser-originated unsafe requests from origins outside the CORS allowlist.
// CORS alone only hides responses; it does not prevent a cross-site form from mutating state.
app.use((req, res, next) => {
  const unsafeMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const origin = req.headers.origin;
  if (unsafeMethod && origin && !isOriginAllowed(origin)) {
    return res.status(403).json({
      success: false,
      code: 'CSRF_ORIGIN_REJECTED',
      message: 'Origin tidak diizinkan untuk permintaan yang mengubah data.'
    });
  }
  next();
});

// 1c. Sensitive File & Static Asset Access Protection (with path traversal normalization)
app.use((req, res, next) => {
  let decodedPath = req.path;
  try {
    decodedPath = decodeURIComponent(req.path);
    // Double-decode check to prevent double-encoding bypasses (%252e%252e%252f)
    if (decodedPath.includes('%')) {
      decodedPath = decodeURIComponent(decodedPath);
    }
  } catch (_) {
    // Malformed URI sequence
    return res.status(400).json({
      success: false,
      code: 'BAD_REQUEST',
      message: 'Permintaan URI tidak valid.'
    });
  }

  const reqPath = decodedPath.toLowerCase().replace(/\\/g, '/');

  // Prevent path traversal attempts
  if (reqPath.includes('..') || reqPath.includes('/.') || reqPath.includes('//')) {
    return res.status(403).json({
      success: false,
      code: 'ACCESS_DENIED',
      message: 'Akses ke berkas internal sistem tidak diizinkan.'
    });
  }

  // Strictly prohibit direct exposure of .env, sqlite databases, private data directories, test files, package internals, and server source code
  if (
    reqPath.includes('.env') ||
    reqPath.includes('.sqlite') ||
    reqPath.includes('.git') ||
    reqPath.startsWith('/data/') ||
    reqPath.startsWith('/server/') ||
    reqPath.startsWith('/test/') ||
    reqPath === '/server.js' ||
    reqPath === '/package.json' ||
    reqPath === '/package-lock.json'
  ) {
    return res.status(403).json({
      success: false,
      code: 'ACCESS_DENIED',
      message: 'Akses ke berkas internal sistem tidak diizinkan.'
    });
  }
  next();
});

// 2. Static Assets Serving
app.use(express.static(__dirname, {
  dotfiles: 'deny',
  index: ['index.html'],
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
  }
}));


// 3. Mount Modular REST API Routes
app.use('/api', apiRoutes);
app.use('/api', (req, res) => res.status(404).json({
  success: false,
  type: 'error',
  code: 'API_ROUTE_NOT_FOUND',
  message: 'Endpoint API tidak ditemukan.',
  data: null
}));

// Keep parser and unexpected route errors in the same JSON contract without leaking internals.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  const statusCode = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  const code = statusCode === 413 ? 'PAYLOAD_TOO_LARGE' :
    statusCode === 400 ? 'INVALID_REQUEST' : 'INTERNAL_SERVER_ERROR';

  if (statusCode >= 500) {
    console.error('[HTTP] Unhandled request error:', error?.message || error);
  }

  return res.status(statusCode).json({
    success: false,
    type: 'error',
    code,
    message: statusCode === 413 ? 'Ukuran permintaan melebihi batas.' :
      statusCode === 400 ? 'Permintaan tidak dapat dibaca.' :
        'Terjadi kesalahan internal. Coba lagi nanti.',
    data: null
  });
});

// 4. Initialize Real-Time WebSockets Engine
initializeSocketServer(server);

// 5. Start HTTP & WebSocket Server Listen
const activePort = process.env.PORT !== undefined ? parseInt(process.env.PORT, 10) : PORT;
server.listen(activePort, HOST, () => {
  console.log(`\n🚦 ===================================================`);
  console.log(`   OmniTRAF Surabaya Traffic Control Center Online   `);
  console.log(`   Server       : http://${HOST}:${activePort}             `);
  console.log(`   Architecture : Clean Layered Architecture (Modular)`);
  console.log(`   Security     : JWT Auth + RBAC + CSP + RateLimit `);
  console.log(`===================================================\n`);
});

export { app, server };
