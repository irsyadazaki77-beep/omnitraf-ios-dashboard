import { backendState } from '../services/stateManager.js';
import { ScenarioLabService } from '../services/scenarioLabService.js';
import { createApiResponse, createApiErrorResponse } from '../middlewares/errorHandler.js';

const service = new ScenarioLabService({ getState: () => {
  const snapshot = backendState.getSnapshot();
  return { ...(snapshot.state || {}), stateVersion: snapshot.stateVersion, seq: snapshot.seq };
} });

function respondError(res, error) {
  const status = Number(error.status) || 500;
  return res.status(status).json(createApiErrorResponse(status, error.code || 'SCENARIO_LAB_FAILED', error.message || 'Scenario Lab request failed.'));
}

export function getScenarioLabPresets(_req, res) {
  return res.status(200).json(createApiResponse({ type: 'scenario_lab_presets', data: service.listPresets(), extra: { status: 'success' } }));
}

export function compareScenarioLab(req, res) {
  try {
    const data = service.compare(req.body || {});
    return res.status(200).json(createApiResponse({ type: 'scenario_lab_comparison', data, extra: { status: 'success' } }));
  } catch (error) { return respondError(res, error); }
}

export function createScenarioLabSession(req, res) {
  try {
    const data = service.create(req.user.id, req.body || {});
    return res.status(201).json(createApiResponse({ type: 'scenario_lab_session', data, extra: { status: 'success' } }));
  } catch (error) { return respondError(res, error); }
}

export function getScenarioLabSession(req, res) {
  try {
    const data = service.snapshot(req.params.sessionId, req.user.id);
    return res.status(200).json(createApiResponse({ type: 'scenario_lab_session', data, extra: { status: 'success' } }));
  } catch (error) { return respondError(res, error); }
}

export function controlScenarioLabSession(req, res) {
  try {
    const data = service.control(req.params.sessionId, req.user.id, req.body?.action);
    return res.status(200).json(createApiResponse({ type: 'scenario_lab_session', data, extra: { status: 'success' } }));
  } catch (error) { return respondError(res, error); }
}

export function deleteScenarioLabSession(req, res) {
  try {
    service.remove(req.params.sessionId, req.user.id);
    return res.status(200).json(createApiResponse({ type: 'scenario_lab_session_deleted', data: { id: req.params.sessionId }, extra: { status: 'success' } }));
  } catch (error) { return respondError(res, error); }
}

