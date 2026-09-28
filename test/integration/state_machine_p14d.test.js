import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import { backendState } from '../../server/services/stateManager.js';
import { commandExecutor } from '../../server/services/commandExecutor.js';
import { dbManager } from '../../server/db/database.js';
import { ROLES } from '../../server/config/constants.js';
import {
  INCIDENT_STATES,
  EMERGENCY_STATES,
  validateIncidentTransition,
  validateEmergencyTransition,
  normalizeIncidentStatus,
  normalizeEmergencyStatus,
  createDomainEventEnvelope
} from '../../server/config/stateMachine.js';

// Setup environment variables before importing server
process.env.PORT = '0';
const testDbPath = 'data/test_state_machine_p14d.sqlite';
process.env.DB_PATH = testDbPath;

const { server } = await import('../../server.js');

describe('PHASE 14D — Formal Incident & Emergency State Machine + Cross-Module Orchestration Tests', () => {
  let baseUrl;
  let adminToken;
  let operatorToken;
  let viewerToken;

  before(async () => {
    await new Promise((resolve) => {
      if (server.listening) {
        resolve();
      } else {
        server.listen(0, '127.0.0.1', () => {
          resolve();
        });
      }
    });

    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    // Get Auth Tokens
    const adminRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    adminToken = (await adminRes.json()).token;

    const opRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'operator', password: 'operator123' })
    });
    operatorToken = (await opRes.json()).token;

    const viewRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer123' })
    });
    viewerToken = (await viewRes.json()).token;
  });

  after(() => {
    server.close();
    try {
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    } catch (_) {}
  });

  // 1. Formal Incident Lifecycle State Machine Matrix
  test('1. Incident State Machine: Full valid progression (ACTIVE -> ACKNOWLEDGED -> DISPATCHED -> RESPONDING -> MITIGATED -> RESOLVED -> ARCHIVED)', () => {
    assert.strictEqual(validateIncidentTransition('ACTIVE', 'ACKNOWLEDGED').valid, true);
    assert.strictEqual(validateIncidentTransition('ACKNOWLEDGED', 'DISPATCHED').valid, true);
    assert.strictEqual(validateIncidentTransition('DISPATCHED', 'RESPONDING').valid, true);
    assert.strictEqual(validateIncidentTransition('RESPONDING', 'MITIGATED').valid, true);
    assert.strictEqual(validateIncidentTransition('MITIGATED', 'RESOLVED').valid, true);
    assert.strictEqual(validateIncidentTransition('RESOLVED', 'ARCHIVED').valid, true);

    // Direct resolution allowed from intermediate states
    assert.strictEqual(validateIncidentTransition('ACTIVE', 'RESOLVED').valid, true);
    assert.strictEqual(validateIncidentTransition('DISPATCHED', 'RESOLVED').valid, true);

    // Same state no-op
    assert.strictEqual(validateIncidentTransition('ACTIVE', 'ACTIVE').valid, true);
  });

  // 2. Invalid Incident Transition Rejection (Arbitrary jumps & Reactivation prohibited)
  test('2. Incident State Machine: Invalid transition rejection (RESOLVED -> ACTIVE, ARCHIVED -> RESOLVED, ACTIVE -> MITIGATED)', () => {
    // Prohibit reactivation
    const reactivate = validateIncidentTransition('RESOLVED', 'ACTIVE');
    assert.strictEqual(reactivate.valid, false);
    assert.ok(reactivate.reason.includes('Transisi tidak sah'));

    const reactivateAck = validateIncidentTransition('RESOLVED', 'ACKNOWLEDGED');
    assert.strictEqual(reactivateAck.valid, false);

    // Terminal archived state has no valid outgoing transitions
    const fromArchived = validateIncidentTransition('ARCHIVED', 'RESOLVED');
    assert.strictEqual(fromArchived.valid, false);

    // Arbitrary skips without intermediate step
    const skipToMitigated = validateIncidentTransition('ACTIVE', 'MITIGATED');
    assert.strictEqual(skipToMitigated.valid, false);

    // Invalid status string
    const invalidStatus = validateIncidentTransition('ACTIVE', 'NON_EXISTENT_STATE');
    assert.strictEqual(invalidStatus.valid, false);
  });

  // 3. Normalization of legacy ambiguous status strings
  test('3. Incident State Machine: Legacy normalization converts DISPATCHED/RESPONDING to canonical DISPATCHED', () => {
    assert.strictEqual(normalizeIncidentStatus('DISPATCHED/RESPONDING'), INCIDENT_STATES.DISPATCHED);
    assert.strictEqual(normalizeIncidentStatus(' active '), INCIDENT_STATES.ACTIVE);
  });

  // 4. Emergency State Machine Matrix
  test('4. Emergency State Machine: Full valid progression (REQUESTED -> VERIFIED -> DISPATCHED -> ROUTE_PREEMPTION -> EN_ROUTE -> ARRIVED -> COMPLETED -> TERMINAL_ARCHIVED)', () => {
    assert.strictEqual(validateEmergencyTransition('REQUESTED', 'VERIFIED').valid, true);
    assert.strictEqual(validateEmergencyTransition('VERIFIED', 'DISPATCHED').valid, true);
    assert.strictEqual(validateEmergencyTransition('DISPATCHED', 'ROUTE_PREEMPTION').valid, true);
    assert.strictEqual(validateEmergencyTransition('ROUTE_PREEMPTION', 'EN_ROUTE').valid, true);
    assert.strictEqual(validateEmergencyTransition('EN_ROUTE', 'ARRIVED').valid, true);
    assert.strictEqual(validateEmergencyTransition('ARRIVED', 'COMPLETED').valid, true);
    assert.strictEqual(validateEmergencyTransition('COMPLETED', 'TERMINAL_ARCHIVED').valid, true);

    // Cancellation allowed from active states
    assert.strictEqual(validateEmergencyTransition('REQUESTED', 'CANCELLED').valid, true);
    assert.strictEqual(validateEmergencyTransition('DISPATCHED', 'CANCELLED').valid, true);
    assert.strictEqual(validateEmergencyTransition('EN_ROUTE', 'CANCELLED').valid, true);
    assert.strictEqual(validateEmergencyTransition('CANCELLED', 'TERMINAL_ARCHIVED').valid, true);
  });

  // 5. Emergency Invalid Transitions
  test('5. Emergency State Machine: Invalid transition rejection (COMPLETED -> REQUESTED, CANCELLED -> EN_ROUTE)', () => {
    const reactivate = validateEmergencyTransition('COMPLETED', 'REQUESTED');
    assert.strictEqual(reactivate.valid, false);

    const fromCancelled = validateEmergencyTransition('CANCELLED', 'EN_ROUTE');
    assert.strictEqual(fromCancelled.valid, false);

    const terminalToActive = validateEmergencyTransition('TERMINAL_ARCHIVED', 'REQUESTED');
    assert.strictEqual(terminalToActive.valid, false);
  });

  // 6. Server Authoritative Execution & Domain Event Structure
  test('6. Authoritative Execution: updateIncidentStatus produces standard domain event structure with correlation', async () => {
    const incId = `INC-EVT-${Date.now()}`;
    const testInc = {
      id: incId,
      title: 'Mogok di frontage road',
      category: 'congestion',
      severity: 'medium',
      location: 'Jl. Ahmad Yani',
      status: INCIDENT_STATES.ACTIVE,
      assignedUnit: 'Dishub Patroli'
    };
    backendState.state.incidents.unshift(testInc);

    const updated = backendState.updateIncidentStatus(incId, INCIDENT_STATES.ACKNOWLEDGED, 'Petugas Pos 1', 'Diterima operator', {
      commandId: 'CMD-EVT-01',
      correlationId: 'CORR-EVT-01',
      actor: 'Operator 112 Surabaya'
    });

    assert.strictEqual(updated.status, INCIDENT_STATES.ACKNOWLEDGED);
    assert.strictEqual(updated.assignedUnit, 'Petugas Pos 1');

    // Verify audit log
    const audit = backendState.auditLogs.find(a => a.correlationId === 'CORR-EVT-01');
    assert.ok(audit, 'Audit log must record stable correlation ID');
    assert.strictEqual(audit.operator, 'Operator 112 Surabaya');
  });

  // 7. Cross-Module Orchestration: Emergency Activation -> Preemption + Green Wave + Linkage
  test('7. Cross-Module Orchestration: Emergency Activation triggers Green Wave, route preemption snapshot, and links associated incident', async () => {
    const incId = `INC-LINK-${Date.now()}`;
    const testInc = {
      id: incId,
      title: 'Kecelakaan Beruntun',
      category: 'accident',
      severity: 'high',
      location: 'Simpang Wonokromo',
      status: INCIDENT_STATES.ACTIVE,
      assignedUnit: 'Menunggu Disposisi'
    };
    backendState.state.incidents.unshift(testInc);

    const vehicleCode = `AMB-P14D-${Date.now().toString().slice(-4)}`;
    const outcome = await commandExecutor.executeCommand({
      action: 'emergency:activate',
      payload: {
        code: vehicleCode,
        route: 'route-soetomo',
        incidentId: incId
      },
      commandId: `CMD-EMG-LINK-${Date.now()}`,
      correlationId: `CORR-EMG-LINK-${Date.now()}`,
      authenticatedUser: { id: 'usr-admin', name: 'Zaki Admin', role: ROLES.ADMIN }
    });

    assert.strictEqual(outcome.success, true);
    assert.strictEqual(backendState.state.greenWaveActive, true, 'Green Wave must be active');

    // Check linked incident was updated to DISPATCHED with associatedEmergencyId
    const linkedInc = backendState.state.incidents.find(i => i.id === incId);
    assert.ok(linkedInc);
    assert.strictEqual(linkedInc.associatedEmergencyId, outcome.resultingState.activeEmergencies[0].id);
    assert.strictEqual(linkedInc.status, INCIDENT_STATES.DISPATCHED);

    // Clean up emergency
    await commandExecutor.executeCommand({
      action: 'emergency:cancel',
      targetId: outcome.resultingState.activeEmergencies[0].id,
      authenticatedUser: { id: 'usr-admin', name: 'Zaki Admin', role: ROLES.ADMIN }
    });
  });

  // 8. Cross-Module Conflict: Cannot resolve incident while associated emergency is actively responding
  test('8. Cross-Module Conflict: Resolving incident is rejected if associated emergency is still actively responding', async () => {
    const incId = `INC-CONFLICT-${Date.now()}`;
    const emgId = `EMG-CONFLICT-${Date.now()}`;
    
    // Add active emergency
    const emgItem = {
      id: emgId,
      vehicleId: 'AMB-CONFLICT',
      vehicleType: 'Ambulance',
      status: EMERGENCY_STATES.EN_ROUTE,
      routeId: 'route-soetomo'
    };
    backendState.state.activeEmergencies.unshift(emgItem);

    // Add incident linked to active emergency
    const testInc = {
      id: incId,
      title: 'Pohon Tumbang Menghalangi Lajur',
      category: 'hazard',
      severity: 'high',
      location: 'Jl. Raya Darmo',
      status: INCIDENT_STATES.DISPATCHED,
      associatedEmergencyId: emgId
    };
    backendState.state.incidents.unshift(testInc);

    // Attempt to resolve incident directly via commandExecutor or backendState
    await assert.rejects(
      async () => {
        backendState.updateIncidentStatus(incId, INCIDENT_STATES.RESOLVED);
      },
      /STATE_CONFLICT.*armada tanggap darurat.*masih berstatus aktif/
    );

    // Mark emergency as ARRIVED -> Now resolution succeeds
    emgItem.status = EMERGENCY_STATES.ARRIVED;
    const resolved = backendState.updateIncidentStatus(incId, INCIDENT_STATES.RESOLVED);
    assert.strictEqual(resolved.status, INCIDENT_STATES.RESOLVED);

    // Clean up
    backendState.state.activeEmergencies = backendState.state.activeEmergencies.filter(e => e.id !== emgId);
  });

  // 9. Cross-Module Orchestration: Emergency Cancel cleanly restores temporary signal overrides and Green Wave
  test('9. Cross-Module Orchestration: Emergency Cancel restores signals and disables Green Wave if no other emergency active', async () => {
    const vehicleCode = `AMB-RESTORE-${Date.now().toString().slice(-4)}`;
    
    // Activate emergency
    const activateOutcome = await commandExecutor.executeCommand({
      action: 'emergency:activate',
      payload: { code: vehicleCode, route: 'route-soetomo' },
      commandId: `CMD-EMG-RESTORE-${Date.now()}`,
      correlationId: `CORR-EMG-RESTORE-${Date.now()}`,
      authenticatedUser: { id: 'usr-admin', name: 'Zaki Admin', role: ROLES.ADMIN }
    });

    const activeEmgId = activateOutcome.resultingState.activeEmergencies[0].id;
    assert.strictEqual(backendState.state.greenWaveActive, true);

    // Simulate signal preemption applied
    const wonokromo = backendState.state.intersections.find(n => n.id === 'node-wonokromo');
    wonokromo.isPreempted = true;
    wonokromo.preemptionVehicleId = activeEmgId;
    wonokromo.status = 'Preemption Aktif';

    // Cancel emergency
    await commandExecutor.executeCommand({
      action: 'emergency:cancel',
      targetId: activeEmgId,
      commandId: `CMD-CANCEL-RESTORE-${Date.now()}`,
      correlationId: `CORR-CANCEL-RESTORE-${Date.now()}`,
      authenticatedUser: { id: 'usr-admin', name: 'Zaki Admin', role: ROLES.ADMIN }
    });

    // Verify signal preemption cleared and restored to normal
    assert.strictEqual(wonokromo.isPreempted, undefined);
    assert.strictEqual(wonokromo.preemptionVehicleId, undefined);
    assert.strictEqual(wonokromo.status, 'Normal');
    assert.strictEqual(backendState.state.greenWaveActive, false, 'Green wave must be deactivated after last emergency cancel');
  });

  // 10. Duplicate Command Idempotency for Emergency Activation
  test('10. Command Idempotency: Duplicate emergency activation returns cached authoritative result without duplicate dispatch', async () => {
    const commandId = `CMD-IDEMP-EMG-${Date.now()}`;
    const idempotencyKey = `IDEMP-KEY-EMG-${Date.now()}`;
    const correlationId = `CORR-IDEMP-EMG-${Date.now()}`;
    const vehicleCode = `AMB-IDEMP-${Date.now().toString().slice(-4)}`;

    // First execution
    const firstRes = await commandExecutor.executeCommand({
      action: 'emergency:activate',
      payload: { code: vehicleCode, route: 'route-soetomo' },
      commandId,
      idempotencyKey,
      correlationId,
      authenticatedUser: { id: 'usr-admin', name: 'Zaki Admin', role: ROLES.ADMIN }
    });

    assert.strictEqual(firstRes.success, true);
    assert.strictEqual(firstRes.status, 'SERVER_APPLIED');
    const firstSeq = backendState.emergencySequence;
    const emgCountAfterFirst = backendState.state.activeEmergencies.length;

    // Retry with SAME idempotencyKey
    const replayRes = await commandExecutor.executeCommand({
      action: 'emergency:activate',
      payload: { code: vehicleCode, route: 'route-soetomo' },
      commandId: `CMD-RETRY-${Date.now()}`,
      idempotencyKey,
      correlationId: `CORR-RETRY-${Date.now()}`,
      authenticatedUser: { id: 'usr-admin', name: 'Zaki Admin', role: ROLES.ADMIN }
    });

    assert.strictEqual(replayRes.success, true);
    assert.strictEqual(replayRes.isIdempotentReplay, true, 'Must be flagged as idempotent replay');
    assert.strictEqual(backendState.emergencySequence, firstSeq, 'Sequence must not increment on duplicate');
    assert.strictEqual(backendState.state.activeEmergencies.length, emgCountAfterFirst, 'No duplicate emergency added');

    // Clean up
    backendState.cancelEmergency(firstRes.resultingState.activeEmergencies[0].id);
  });

  // 11. REST API Invalid State Transition returns HTTP 409 STATE_CONFLICT
  test('11. REST Endpoint: Invalid transition returns HTTP 409 with STATE_CONFLICT and descriptive reason', async () => {
    const incId = `INC-REST-CONFLICT-${Date.now()}`;
    const testInc = {
      id: incId,
      title: 'Kendaraan Terguling',
      category: 'accident',
      severity: 'critical',
      location: 'Jl. Mayjen Sungkono',
      status: INCIDENT_STATES.ACTIVE
    };
    backendState.state.incidents.unshift(testInc);

    // Attempting invalid transition ACTIVE -> MITIGATED
    const res = await fetch(`${baseUrl}/api/incidents/${incId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${operatorToken}`
      },
      body: JSON.stringify({ status: 'MITIGATED' })
    });

    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.strictEqual(body.code, 'STATE_CONFLICT');
    assert.ok(body.message.includes('Transisi tidak sah'));
  });

  // 12. REST Endpoint Idempotency for Emergency Activation
  test('12. REST Endpoint: Duplicate emergency activation returns HTTP 200 with isIdempotentReplay', async () => {
    const vCode = `AMB-REST-IDEMP-${Date.now().toString().slice(-4)}`;
    const idempKey = `IDEMP-REST-KEY-${Date.now()}`;

    // 1st request -> 201
    const res1 = await fetch(`${baseUrl}/api/emergencies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${operatorToken}`,
        'X-Idempotency-Key': idempKey
      },
      body: JSON.stringify({ code: vCode, route: 'route-soetomo' })
    });
    assert.strictEqual(res1.status, 201);
    const data1 = await res1.json();
    assert.strictEqual(data1.success, true);

    // 2nd duplicate request with same idempotency key -> 200 with isIdempotentReplay
    const res2 = await fetch(`${baseUrl}/api/emergencies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${operatorToken}`,
        'X-Idempotency-Key': idempKey
      },
      body: JSON.stringify({ code: vCode, route: 'route-soetomo' })
    });
    assert.strictEqual(res2.status, 200);
    const data2 = await res2.json();
    assert.strictEqual(data2.success, true);
    assert.strictEqual(data2.isIdempotentReplay, true);

    // Clean up
    await fetch(`${baseUrl}/api/emergencies/${vCode}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${operatorToken}` }
    });
  });

  // 13. Terminal-State Cleanup: Emergency tick() completion cleans up route preemption and green wave
  test('13. Terminal-State Cleanup: Emergency ARRIVED -> COMPLETED clears preemption and restores cycle', () => {
    const emgId = `EMG-COMPLETION-${Date.now()}`;
    const emgItem = {
      id: emgId,
      vehicleId: 'AMB-FINISH',
      vehicleType: 'Ambulance',
      status: EMERGENCY_STATES.ARRIVED,
      routeId: 'route-soetomo',
      holdTicks: 2 // Next tick will reach 3 -> COMPLETED
    };
    backendState.state.activeEmergencies.unshift(emgItem);
    backendState.state.greenWaveActive = true;

    // Simulate preemption on Wonokromo
    const node = backendState.state.intersections.find(n => n.id === 'node-wonokromo');
    node.isPreempted = true;
    node.preemptionVehicleId = emgId;

    // Execute stateManager tick
    backendState.tick();

    // Verify emg transitioned to COMPLETED and preemption on node cleared
    assert.strictEqual(emgItem.status, EMERGENCY_STATES.COMPLETED);
    assert.strictEqual(node.isPreempted, undefined);
    assert.strictEqual(node.preemptionVehicleId, undefined);
    assert.ok(node.status === 'Lancar' || node.status === 'Normal');

    // Clean up
    backendState.state.activeEmergencies = backendState.state.activeEmergencies.filter(e => e.id !== emgId);
    backendState.state.greenWaveActive = false;
  });
});
