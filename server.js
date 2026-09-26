import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { PORT } from './server/config/env.js';
import { dbManager } from './server/db/database.js';
import { corsMiddleware, securityHeadersMiddleware } from './server/middlewares/security.js';
import { rateLimiter } from './server/middlewares/rateLimiter.js';
import { initializeSocketServer } from './server/sockets/socketServer.js';
import apiRoutes from './server/routes/apiRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// 1. Security & Standard Middlewares
app.use(corsMiddleware);
app.use(securityHeadersMiddleware);

// 1b. Liveness & Readiness Endpoints
app.get('/healthz', (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/ready', (req, res) => {
  const dbReady = dbManager.isInitialized && dbManager.db !== null;
  let dbStatus = 'DISCONNECTED';
  if (dbReady) {
    try {
      dbManager.db.exec('SELECT 1;');
      dbStatus = 'CONNECTED';
    } catch (err) {
      dbStatus = 'DEGRADED';
    }
  }

  const isReady = dbStatus === 'CONNECTED';
  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'READY' : 'OUT_OF_SERVICE',
    timestamp: new Date().toISOString(),
    components: {
      database: dbStatus,
      process: 'RUNNING'
    }
  });
});

app.use(rateLimiter({ windowMs: 15000, max: 200, keyPrefix: 'api-global' }));
app.use(express.json({ limit: '1mb' }));

// 2. Static Assets Serving
app.use(express.static(__dirname, {
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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚦 ===================================================`);
  console.log(`   OmniTRAF Surabaya Traffic Control Center Online   `);
  console.log(`   Local Server : http://localhost:${PORT}             `);
  console.log(`   Architecture : Clean Layered Architecture (Modular)`);
  console.log(`   Security     : JWT Auth + RBAC + CSP + RateLimit `);
  console.log(`===================================================\n`);
});

export { app, server };
