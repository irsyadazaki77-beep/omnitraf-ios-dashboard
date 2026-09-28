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
import { PORT } from './server/config/env.js';
import { dbManager } from './server/db/database.js';
import { backendState } from './server/services/stateManager.js';
import { corsMiddleware, securityHeadersMiddleware } from './server/middlewares/security.js';
import { rateLimiter } from './server/middlewares/rateLimiter.js';
import { initializeSocketServer } from './server/sockets/socketServer.js';
import apiRoutes from './server/routes/apiRoutes.js';
import { diagnosticEngine } from './server/services/diagnosticEngine.js';

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

// 1b. Liveness & Readiness Endpoints
app.get('/healthz', (req, res) => {
  res.status(200).json({
    success: true,
    type: 'health_liveness',
    status: 'OK',
    uptime: process.uptime(),
    pid: process.pid,
    timestamp: new Date().toISOString()
  });
});

app.get('/ready', (req, res) => {
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
      message: 'Sistem SITS belum siap menerima trafik: dependensi database atau hidrasi state belum tuntas.'
    }
  });
});

app.use(rateLimiter({ windowMs: 15000, max: 200, keyPrefix: 'api-global' }));
app.use(express.json({ limit: '1mb' }));

// 1c. Sensitive File & Static Asset Access Protection
app.use((req, res, next) => {
  const reqPath = req.path.toLowerCase().replace(/\\/g, '/');
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

// 4. Initialize Real-Time WebSockets Engine
initializeSocketServer(server);

// 5. Start HTTP & WebSocket Server Listen
const activePort = process.env.PORT !== undefined ? parseInt(process.env.PORT, 10) : PORT;
server.listen(activePort, '0.0.0.0', () => {
  console.log(`\n🚦 ===================================================`);
  console.log(`   OmniTRAF Surabaya Traffic Control Center Online   `);
  console.log(`   Local Server : http://localhost:${activePort}             `);
  console.log(`   Architecture : Clean Layered Architecture (Modular)`);
  console.log(`   Security     : JWT Auth + RBAC + CSP + RateLimit `);
  console.log(`===================================================\n`);
});

export { app, server };
