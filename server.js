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
import { HOST, PORT, isOriginAllowed, OMNITRAF_RUNTIME_MODE, REDIS_URL } from './server/config/env.js';
import { dbManager } from './server/db/database.js';
import { backendState } from './server/services/stateManager.js';
import { corsMiddleware, securityHeadersMiddleware } from './server/middlewares/security.js';
import { rateLimiter } from './server/middlewares/rateLimiter.js';
import { initializeSocketServer } from './server/sockets/socketServer.js';
import apiRoutes from './server/routes/apiRoutes.js';
import { diagnosticEngine } from './server/services/diagnosticEngine.js';
import { requireCapability } from './server/middlewares/auth.js';
import { redisManager } from './server/infrastructure/redis/redisManager.js';
import { ClusterEventBus, CLUSTER_CHANNELS } from './server/infrastructure/redis/clusterEventBus.js';
import { SimulationLeadership, runtimeInstanceId } from './server/infrastructure/redis/simulationLeadership.js';
import { clusterRuntime } from './server/infrastructure/redis/clusterRuntimeSingleton.js';
import { commandExecutor } from './server/services/commandExecutor.js';
import { cvEngine } from './server/services/visionEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDirectory = path.join(__dirname, 'dist');

// Ensure persistence layer & state hydration are completed on startup
let startupLifecycle = 'STARTING';
let leadershipManager = null;
let clusterEventBus = null;
try {
  startupLifecycle = 'DATABASE_INITIALIZING';
  await dbManager.init();
  startupLifecycle = 'STATE_HYDRATING';
  await backendState.init();
  startupLifecycle = 'REDIS_COORDINATION';
  if (OMNITRAF_RUNTIME_MODE === 'cluster' || REDIS_URL) {
    try { await redisManager.connect(); }
    catch (error) {
      if (OMNITRAF_RUNTIME_MODE === 'cluster') throw error;
      console.warn('[Redis] Optional Redis connection unavailable; single mode continues locally:', error.message);
    }
  }
  clusterRuntime.redis = redisManager;
  if (OMNITRAF_RUNTIME_MODE === 'cluster') {
    if (!redisManager.isConnected()) throw new Error('OMNITRAF_RUNTIME_MODE=cluster requires an available Redis service.');
    clusterEventBus = new ClusterEventBus(redisManager, runtimeInstanceId);
  }
  leadershipManager = new SimulationLeadership({
    redisManager,
    eventBus: clusterEventBus,
    mode: OMNITRAF_RUNTIME_MODE,
    instanceId: runtimeInstanceId,
    onSnapshot: () => ({ ...backendState.getClusterSnapshot(), cctvSnapshot: cvEngine.getSnapshot() }),
    applySnapshot: (snapshot) => {
      if (!backendState.applyClusterSnapshot(snapshot)) return false;
      if (snapshot.cctvSnapshot) cvEngine.restoreSnapshot(snapshot.cctvSnapshot);
      return true;
    },
    onLeaderReady: () => OMNITRAF_RUNTIME_MODE === 'cluster' ? backendState.persistClusterSnapshot() : undefined,
    onRoleChange: ({ previousRole, role }) => {
      if (role === 'LEADER') backendState.startRuntime();
      else backendState.stopRuntime();
      console.info(`[Leadership] ${previousRole} -> ${role} (${runtimeInstanceId}).`);
    }
  });
  backendState.publishClusterSnapshot = () => leadershipManager?.publishSnapshot();
  clusterRuntime.leadership = leadershipManager;
  clusterRuntime.eventBus = clusterEventBus;
  if (clusterEventBus) {
    await clusterEventBus.subscribe(CLUSTER_CHANNELS.snapshot, (envelope) => leadershipManager.onSnapshotEvent(envelope).catch(() => {}));
    await clusterEventBus.subscribe(CLUSTER_CHANNELS.cctv, (envelope) => {
      if (leadershipManager.isLeader() || !envelope.payload || envelope.sequence < cvEngine.frameSequence) return;
      try { cvEngine.restoreSnapshot(envelope.payload); } catch (_) {}
    });
    await clusterRuntime.startCommandBroker();
  }
  clusterRuntime.configureCommandHandler((params) => commandExecutor.executeCommand(params));
  await leadershipManager.start();
  startupLifecycle = 'READY';
} catch (startupErr) {
  startupLifecycle = 'UNAVAILABLE';
  console.error('❌ [Server Startup] Startup persistence/state gagal; operational traffic dinonaktifkan:', startupErr.message);
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
  const dbHealth = dbManager.getHealth();
  const clusterHealth = leadershipManager?.getDiagnostics() || { mode: OMNITRAF_RUNTIME_MODE, instanceId: runtimeInstanceId, role: 'UNAVAILABLE', redisStatus: OMNITRAF_RUNTIME_MODE === 'single' ? 'NOT_REQUIRED' : redisManager.getHealth().status, synchronized: false };
  const clusterReady = OMNITRAF_RUNTIME_MODE === 'single' || (redisManager.isConnected() && clusterHealth.synchronized && ['LEADER', 'FOLLOWER'].includes(clusterHealth.role));
  const dbReady = dbManager.isInitialized && dbManager.ping() && !hasActiveDbFault && startupLifecycle === 'READY' && dbHealth.status === 'CONNECTED';
  let dbStatus = dbHealth.status === 'DEGRADED' ? 'DEGRADED' : 'DISCONNECTED';
  if (hasActiveDbFault) {
    dbStatus = 'FAULT_INJECTED_UNAVAILABLE';
  } else if (dbReady) {
    dbStatus = dbManager.ping() ? 'CONNECTED' : 'DEGRADED';
  }

  const clientsCount = backendState.io?.engine?.clientsCount || 0;
  const socketStatus = backendState.io ? 'CONNECTED' : 'DISCONNECTED';
  const realtimeStatus = backendState.io && (OMNITRAF_RUNTIME_MODE === 'single' || clusterReady) ? 'READY' : 'UNAVAILABLE';

  const isReady = dbStatus === 'CONNECTED' && backendState.isHydrated && !hasActiveDbFault && clusterReady && realtimeStatus === 'READY';
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
      databaseHealth: dbHealth,
      cluster: { ...clusterHealth, ...clusterRuntime.getDiagnostics() },
      leadership: clusterHealth.role,
      redis: clusterHealth.redisStatus,
      lifecycle: startupLifecycle,
      stateHydration: backendState.isHydrated ? 'COMPLETED' : 'PENDING',
      socketServer: socketStatus,
      realtime: realtimeStatus,
      activeClients: clientsCount,
      process: 'RUNNING'
    },
    data: {
      status,
      components: {
        database: dbStatus,
        databaseHealth: dbHealth,
        cluster: { ...clusterHealth, ...clusterRuntime.getDiagnostics() },
        leadership: clusterHealth.role,
        redis: clusterHealth.redisStatus,
        lifecycle: startupLifecycle,
        stateHydration: backendState.isHydrated ? 'COMPLETED' : 'PENDING',
        socketServer: socketStatus,
        realtime: realtimeStatus,
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

// 2. Only the explicit production build is a public static surface.
app.use(express.static(distDirectory, {
  dotfiles: 'deny',
  index: ['index.html'],
  fallthrough: true,
  setHeaders: (res, filePath) => {
    const basename = path.basename(filePath);
    if (/^[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|png|jpe?g|webp|svg|woff2?)$/i.test(basename)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else if (basename === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
    if (filePath.endsWith('.webmanifest')) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    }
  }
}));


// 3. Mount Modular REST API Routes
app.use('/api', (req, res, next) => {
  const clusterUnavailable = OMNITRAF_RUNTIME_MODE === 'cluster' && (!redisManager.isConnected() || !leadershipManager?.synchronized);
  if (startupLifecycle !== 'READY' || clusterUnavailable) {
    return res.status(503).json({ success: false, code: 'SERVICE_UNAVAILABLE', message: 'Backend belum siap menerima perintah operasional.', lifecycle: startupLifecycle });
  }
  next();
});
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
const io = startupLifecycle === 'READY' ? initializeSocketServer(server, { redisManager, leadership: leadershipManager }) : null;

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

let shutdownPromise = null;
export function shutdown(signal = 'manual', timeoutMs = 10000) {
  if (shutdownPromise) return shutdownPromise;
  startupLifecycle = 'SHUTTING_DOWN';
  shutdownPromise = (async () => {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('SHUTDOWN_TIMEOUT')), timeoutMs).unref());
    const work = (async () => {
      const httpClosed = new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      });
      backendState.stopRuntime?.();
      backendState.simEngine?.stop?.();
      io?.data?.stopSimulationLoops?.();
      io?.data?.unsubscribeLeadership?.();
      io?.data?.intervalTimers?.forEach((timer) => clearInterval(timer));
      if (io) await new Promise((resolve) => io.close(() => resolve()));
      try {
        if (dbManager.isInitialized) {
          dbManager.setMetadata('shutdown_signal', signal);
          dbManager.setMetadata('last_shutdown_at', new Date().toISOString());
          dbManager.markDirty();
          const persisted = await dbManager.flush();
          if (!persisted) throw new Error(`DATABASE_FLUSH_FAILED: ${dbManager.getHealth().lastError || 'unknown error'}`);
        }
      } finally {
        await leadershipManager?.stop({ release: true });
        await Promise.allSettled(io?.data?.redisClients?.map((client) => client.quit()) || []);
        if (redisManager.clients.length) await redisManager.disconnect();
        await dbManager.close();
      }
      await httpClosed;
    })();
    try { await Promise.race([work, timeout]); startupLifecycle = 'STOPPED'; }
    catch (err) { console.error('[Server Shutdown] Shutdown tidak selesai dengan bersih:', err.message); startupLifecycle = 'UNAVAILABLE'; }
  })();
  return shutdownPromise;
}

if (process.env.NODE_ENV !== 'test' && !process.env.DB_PATH?.includes('test') && process.env.PORT !== '0') {
  process.once('SIGINT', () => { shutdown('SIGINT').finally(() => { process.exitCode = startupLifecycle === 'STOPPED' ? 0 : 1; }); });
  process.once('SIGTERM', () => { shutdown('SIGTERM').finally(() => { process.exitCode = startupLifecycle === 'STOPPED' ? 0 : 1; }); });
}
