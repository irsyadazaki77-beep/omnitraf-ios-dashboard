import { Router } from 'express';
import { requireCapability } from '../middlewares/auth.js';
import { mutationRateLimiter } from '../middlewares/rateLimiter.js';
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
router.get('/incidents', requireCapability('incidents:read'), getIncidents);
router.post('/incidents', requireCapability('incident:create'), mutationRateLimiter, createIncident);
router.post('/incidents/create-auto', requireCapability('incident:create'), mutationRateLimiter, createIncident);
router.patch('/incidents/:id/status', requireCapability('incident:update-status'), mutationRateLimiter, updateIncidentStatus);
router.patch('/incidents/:id/resolve', requireCapability('incident:resolve'), mutationRateLimiter, resolveIncident);
router.put('/incidents/:id/resolve', requireCapability('incident:resolve'), mutationRateLimiter, resolveIncident);
router.post('/incidents/:id/resolve', requireCapability('incident:resolve'), mutationRateLimiter, resolveIncident);

// Emergency Priority Endpoints
router.get('/emergencies', requireCapability('emergencies:read'), getEmergencies);
router.post('/emergencies', requireCapability('emergency:activate'), mutationRateLimiter, activateEmergencyRest);
router.delete('/emergencies/:id', requireCapability('emergency:cancel'), mutationRateLimiter, cancelEmergencyRest);
router.post('/emergencies/:id/cancel', requireCapability('emergency:cancel'), mutationRateLimiter, cancelEmergencyRest);
router.post('/emergencies/cancel', requireCapability('emergency:cancel'), mutationRateLimiter, cancelEmergencyRest);

// Audit Logs
router.get('/audit-logs', requireCapability('audit:read'), getAuditLogs);

export default router;
