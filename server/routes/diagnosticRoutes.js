import { Router } from 'express';
import { requireAuth } from '../middlewares/auth.js';
import { ROLES } from '../config/constants.js';
import {
  getDiagnosticHealth,
  getDiagnosticSnapshot,
  getDiagnosticEvents,
  injectChaosFault,
  clearChaosFault
} from '../controllers/diagnosticController.js';

const router = Router();

// Public / Health inspection
router.get('/health', getDiagnosticHealth);
router.get('/snapshot', getDiagnosticSnapshot);
router.get('/events', getDiagnosticEvents);

// Chaos injection & control (Admin only)
router.post('/chaos/faults/inject', requireAuth([ROLES.ADMIN]), injectChaosFault);
router.post('/chaos/faults/clear', requireAuth([ROLES.ADMIN]), clearChaosFault);
router.delete('/chaos/faults/:faultId', requireAuth([ROLES.ADMIN]), clearChaosFault);

export default router;
