import { Router } from 'express';
import authRoutes from './authRoutes.js';
import deviceRoutes from './deviceRoutes.js';
import incidentRoutes from './incidentRoutes.js';
import reportRoutes from './reportRoutes.js';
import terminalRoutes from './terminalRoutes.js';
import sandboxRoutes from './sandboxRoutes.js';
import diagnosticRoutes from './diagnosticRoutes.js';
import { getStateSnapshot, streamTrafficSse } from '../controllers/signalController.js';
import { requireCapability } from '../middlewares/auth.js';

const router = Router();

// State & SSE Stream Routes
router.get('/state/snapshot', requireCapability('state:snapshot'), getStateSnapshot);
router.get('/state/resync', requireCapability('state:resync'), getStateSnapshot);
router.get('/stream-traffic', requireCapability('traffic:read'), streamTrafficSse);

// Sub-routers mounting
router.use('/auth', authRoutes);
router.use('/devices', deviceRoutes);
router.use('/diagnostics', diagnosticRoutes);
router.use('/', incidentRoutes);
router.use('/', reportRoutes);
router.use('/', terminalRoutes);
router.use('/v1', sandboxRoutes);

export default router;
