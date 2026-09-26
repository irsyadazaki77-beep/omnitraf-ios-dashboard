import { Router } from 'express';
import authRoutes from './authRoutes.js';
import deviceRoutes from './deviceRoutes.js';
import incidentRoutes from './incidentRoutes.js';
import reportRoutes from './reportRoutes.js';
import terminalRoutes from './terminalRoutes.js';
import sandboxRoutes from './sandboxRoutes.js';
import { getStateSnapshot, streamTrafficSse } from '../controllers/signalController.js';

const router = Router();

// State & SSE Stream Routes
router.get(['/state/snapshot', '/state/resync'], getStateSnapshot);
router.get('/stream-traffic', streamTrafficSse);

// Sub-routers mounting
router.use('/auth', authRoutes);
router.use('/devices', deviceRoutes);
router.use('/', incidentRoutes);
router.use('/', reportRoutes);
router.use('/', terminalRoutes);
router.use('/v1', sandboxRoutes);

export default router;
