import { Router } from 'express';
import { ROLES } from '../config/constants.js';
import { requireAuth } from '../middlewares/auth.js';
import {
  getIncidents,
  getEmergencies,
  getAuditLogs,
  updateIncidentStatus,
  resolveIncident
} from '../controllers/incidentController.js';

const router = Router();

router.get('/incidents', getIncidents);
router.get('/emergencies', getEmergencies);
router.get('/audit-logs', getAuditLogs);
router.patch('/incidents/:id/status', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), updateIncidentStatus);
router.patch('/incidents/:id/resolve', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), resolveIncident);
router.put('/incidents/:id/resolve', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), resolveIncident);
router.post('/incidents/:id/resolve', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), resolveIncident);

export default router;
