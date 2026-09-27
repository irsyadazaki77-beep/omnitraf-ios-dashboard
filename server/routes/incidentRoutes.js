import { Router } from 'express';
import { ROLES } from '../config/constants.js';
import { requireAuth } from '../middlewares/auth.js';
import {
  getIncidents,
  createIncident,
  getEmergencies,
  activateEmergencyRest,
  cancelEmergencyRest,
  getAuditLogs,
  updateIncidentStatus,
  resolveIncident
} from '../controllers/incidentController.js';

const router = Router();

// Incident Endpoints
router.get('/incidents', getIncidents);
router.post('/incidents', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), createIncident);
router.post('/incidents/create-auto', createIncident); // Allow automated Vision Engine / internal agent
router.patch('/incidents/:id/status', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), updateIncidentStatus);
router.patch('/incidents/:id/resolve', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), resolveIncident);
router.put('/incidents/:id/resolve', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), resolveIncident);
router.post('/incidents/:id/resolve', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), resolveIncident);

// Emergency Priority Endpoints
router.get('/emergencies', getEmergencies);
router.post('/emergencies', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), activateEmergencyRest);
router.delete('/emergencies/:id', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), cancelEmergencyRest);
router.post('/emergencies/:id/cancel', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), cancelEmergencyRest);
router.post('/emergencies/cancel', requireAuth([ROLES.OPERATOR, ROLES.ADMIN]), cancelEmergencyRest);

// Audit Logs
router.get('/audit-logs', getAuditLogs);

export default router;
