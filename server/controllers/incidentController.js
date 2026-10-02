import { backendState } from '../services/stateManager.js';
import { createApiResponse, createApiErrorResponse, createCommandErrorResponse, getCommandErrorStatus, sanitizeString } from '../middlewares/errorHandler.js';
import { commandExecutor } from '../services/commandExecutor.js';
import { INCIDENT_STATUS_VALUES, INCIDENT_SEVERITIES, INCIDENT_CATEGORIES } from '../config/contracts.js';

export const VALID_INCIDENT_STATUSES = INCIDENT_STATUS_VALUES;
export const VALID_INCIDENT_SEVERITIES = INCIDENT_SEVERITIES;
export const VALID_INCIDENT_CATEGORIES = INCIDENT_CATEGORIES;

export function getIncidents(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).json(createApiResponse({
    type: "incident_list",
    sequence: backendState.incidentSequence,
    data: backendState.state.incidents,
    extra: {
      status: "success",
      incidents: backendState.state.incidents
    }
  }));
}

export async function createIncident(req, res) {
  // Mass-assignment defense: extract only allowed fields and sanitize control characters & newlines
  const cleanField = (val) => (typeof val === 'string' ? val.replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1F\x7F]/g, '').trim() : val);
  const title = cleanField(req.body?.title);
  const location = cleanField(req.body?.location);
  const category = req.body?.category;
  const severity = req.body?.severity;
  const assignedUnit = cleanField(req.body?.assignedUnit);
  const notes = cleanField(req.body?.notes);
  const id = cleanField(req.body?.id) ?? null;

  try {
    const outcome = await commandExecutor.executeCommand({
      action: 'incident:create', targetId: id,
      payload: { id, title, category, severity, location, assignedUnit, notes },
      commandId: req.headers['x-command-id'] || req.body?.commandId,
      idempotencyKey: req.headers['x-idempotency-key'] || req.body?.idempotencyKey || `IDEMP-REST-INC-CREATE-${id ?? Date.now()}`,
      correlationId: req.headers['x-correlation-id'] || req.body?.correlationId,
      authenticatedUser: req.user, sourceChannel: 'rest'
    });
    const newIncident = outcome.newState;
    res.status(outcome.isIdempotentReplay ? 200 : 201).json(createApiResponse({ type: 'incident_created', sequence: backendState.incidentSequence,
      data: newIncident, extra: { status: 'success', incident: newIncident, commandId: outcome.commandId, command: outcome } }));
  } catch (err) {
    const response = createCommandErrorResponse(err);
    res.status(err.code === 'EXECUTION_FAIL' && err.message.includes('sudah ada') ? 409 : getCommandErrorStatus(err)).json(response);
  }
}

export function getEmergencies(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).json(createApiResponse({
    type: "emergency_list",
    sequence: backendState.emergencySequence,
    data: backendState.state.activeEmergencies,
    extra: {
      status: "success",
      emergencies: backendState.state.activeEmergencies
    }
  }));
}

export async function activateEmergencyRest(req, res) {
  const { code, route, type } = req.body || {};
  const routeId = route;

  const commandId = req.headers['x-command-id'] || req.body?.commandId || `CMD-REST-EMG-${Date.now()}`;
  const correlationId = req.headers['x-correlation-id'] || req.body?.correlationId || `CORR-REST-EMG-${Date.now()}`;
  try {
    const outcome = await commandExecutor.executeCommand({
      action: 'emergency:activate', targetId: code ?? null, payload: {
        code, route: routeId,
        incidentId: req.body?.incidentId || req.body?.associatedIncidentId
      },
      commandId, correlationId,
      idempotencyKey: req.headers['x-idempotency-key'] || req.body?.idempotencyKey || `IDEMP-REST-EMG-${code ?? ''}-${routeId ?? ''}`,
      authenticatedUser: req.user, sourceChannel: 'rest'
    });
    const emergencyItem = outcome.newState;

    res.status(outcome.isIdempotentReplay ? 200 : 201).json(createApiResponse({
      type: "emergency_activated",
      sequence: backendState.emergencySequence,
      data: emergencyItem,
      extra: {
        status: "success",
        emergencyItem,
        commandId: outcome.commandId,
        command: outcome,
        isIdempotentReplay: !!outcome.isIdempotentReplay
      }
    }));
  } catch (err) {
    const conflict = err.message.includes('SUDAH DISPATCHED') || err.message.includes('sedang aktif');
    const response = createCommandErrorResponse(err);
    return res.status(conflict ? 409 : getCommandErrorStatus(err)).json(response);
  }
}

export async function cancelEmergencyRest(req, res) {
  const id = req.params.id ?? req.body?.id;

  const commandId = req.headers['x-command-id'] || req.body?.commandId || `CMD-REST-CANCEL-${Date.now()}`;
  const correlationId = req.headers['x-correlation-id'] || req.body?.correlationId || `CORR-REST-CANCEL-${Date.now()}`;

  try {
    const outcome = await commandExecutor.executeCommand({
      action: 'emergency:cancel', targetId: id, payload: { id }, commandId, correlationId,
      idempotencyKey: req.headers['x-idempotency-key'] || req.body?.idempotencyKey || `IDEMP-REST-CANCEL-${id}`,
      authenticatedUser: req.user, sourceChannel: 'rest'
    });

    res.status(200).json(createApiResponse({
      type: "emergency_cancelled",
      sequence: backendState.emergencySequence,
      data: { id, status: "CANCELLED" }, extra: { command: outcome }
    }));
  } catch (err) {
    const response = createCommandErrorResponse(err);
    return res.status(getCommandErrorStatus(err)).json(response);
  }
}

export function getAuditLogs(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.status(200).json(createApiResponse({
    type: "audit_log_list",
    data: backendState.auditLogs,
    extra: {
      status: "success",
      logs: backendState.auditLogs
    }
  }));
}

export async function updateIncidentStatus(req, res) {
  const incidentId = typeof req.params?.id === 'string' ? sanitizeString(req.params.id, 64) : req.params?.id;
  const status = req.body?.status;
  const assignedUnit = typeof req.body?.assignedUnit === 'string' ? sanitizeString(req.body.assignedUnit, 120) : req.body?.assignedUnit;
  const notes = typeof req.body?.notes === 'string' ? sanitizeString(req.body.notes, 1000) : req.body?.notes;

  try {
    const actorName = req.user.name;
    const correlationId = req.headers['x-correlation-id'] || `CORR-INC-STAT-${Date.now()}`;
    const commandId = req.headers['x-command-id'] || `CMD-INC-STAT-${Date.now()}`;
    const outcome = await commandExecutor.executeCommand({
      action: 'incident:update-status', targetId: incidentId, payload: { status, assignedUnit, notes },
      actor: actorName, correlationId, commandId,
      idempotencyKey: req.headers['x-idempotency-key'] || req.body?.idempotencyKey || `IDEMP-REST-INC-STATUS-${incidentId}-${status}`,
      authenticatedUser: req.user, sourceChannel: 'rest'
    });
    const updated = outcome.newState;
    res.status(200).json(createApiResponse({
      type: "incident_status_updated",
      sequence: backendState.incidentSequence,
      data: updated,
      extra: {
        status: "success",
        data: updated,
        command: outcome
      }
    }));
  } catch (err) {
    console.error('❌ [API Incident Status] Error:', err);
    const response = createCommandErrorResponse(err);
    const statusCode = err.message.includes('STATE_CONFLICT') || err.message.includes('Transisi') ? 409 : getCommandErrorStatus(err);
    res.status(statusCode).json(response);
  }
}

export async function resolveIncident(req, res) {
  const incidentId = typeof req.params?.id === 'string' ? sanitizeString(req.params.id, 64) : req.params?.id;

  const commandId = req.headers['x-command-id'] || req.body?.commandId || `CMD-REST-RESOLVE-${Date.now()}`;
  const correlationId = req.headers['x-correlation-id'] || req.body?.correlationId || `CORR-REST-RESOLVE-${Date.now()}`;
  const resolverName = req.user.name;

  try {
    const outcome = await commandExecutor.executeCommand({
      action: 'incident:resolve', targetId: incidentId, payload: { id: incidentId },
      commandId, correlationId,
      idempotencyKey: req.headers['x-idempotency-key'] || req.body?.idempotencyKey || `IDEMP-REST-INC-RESOLVE-${incidentId}`,
      authenticatedUser: req.user, sourceChannel: 'rest'
    });
    const updated = outcome.newState;

    res.status(200).json(createApiResponse({
      type: "incident_resolved",
      sequence: backendState.incidentSequence,
      data: updated,
      extra: {
        statusCode: 200,
        id: incidentId,
        status: "RESOLVED",
        message: `Insiden #${incidentId} telah berhasil ditandai Selesai di Backend SITS.`,
        timestamp: backendState._getWibTimeString(),
        resolvedBy: resolverName,
        command: outcome
      }
    }));
  } catch (err) {
    console.error('❌ [API Incident Resolve] Error:', err);
    const response = createCommandErrorResponse(err);
    const statusCode = err.message.includes('STATE_CONFLICT') || err.message.includes('masih berstatus aktif') ? 409 : getCommandErrorStatus(err);
    res.status(statusCode).json(response);
  }
}
