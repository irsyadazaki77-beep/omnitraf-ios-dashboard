import { backendState } from '../services/stateManager.js';

export function getIncidents(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    status: "success",
    success: true,
    timestamp: Date.now(),
    version: backendState.sequence,
    incidents: backendState.state.incidents
  });
}

export function getEmergencies(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    success: true,
    status: "success",
    timestamp: Date.now(),
    version: backendState.sequence,
    emergencies: backendState.state.activeEmergencies
  });
}

export function getAuditLogs(req, res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    success: true,
    status: "success",
    timestamp: Date.now(),
    logs: backendState.auditLogs
  });
}

export function updateIncidentStatus(req, res) {
  const incidentId = req.params.id;
  const { status, assignedUnit, notes } = req.body || {};

  if (!status) {
    return res.status(400).json({
      success: false,
      type: "validation_error",
      timestamp: Date.now(),
      error: "Status parameter is required."
    });
  }

  try {
    const updated = backendState.updateIncidentStatus(incidentId, status, assignedUnit, notes);
    res.status(200).json({
      success: true,
      type: "incident_status_updated",
      timestamp: Date.now(),
      version: backendState.sequence,
      data: updated
    });
  } catch (err) {
    console.error('❌ [API Incident Status] Error:', err);
    res.status(err.message.includes("tidak ditemukan") ? 404 : 400).json({
      success: false,
      type: "error",
      timestamp: Date.now(),
      error: err.message
    });
  }
}

export function resolveIncident(req, res) {
  const incidentId = req.params.id;
  
  try {
    const updated = backendState.updateIncidentStatus(incidentId, "RESOLVED");
    res.status(200).json({
      success: true,
      statusCode: 200,
      id: incidentId,
      status: "RESOLVED",
      message: `Insiden #${incidentId} telah berhasil ditandai Selesai di Backend SITS.`,
      timestamp: backendState._getWibTimeString(),
      resolvedBy: req.user?.name || "Operator SITS 112 Surabaya",
      data: updated
    });
  } catch (err) {
    console.error('❌ [API Incident Resolve] Error:', err);
    res.status(err.message.includes("tidak ditemukan") ? 404 : 400).json({
      success: false,
      type: "error",
      timestamp: Date.now(),
      error: err.message
    });
  }
}
