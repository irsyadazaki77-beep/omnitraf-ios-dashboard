import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incidentRepository } from '../../server/repositories/incidentRepository.js';
import { dbManager } from '../../server/db/database.js';

test('backend hydration fails closed when a mandatory repository query fails', async () => {
  const originalFindAll = incidentRepository.findAll;
  incidentRepository.findAll = async () => ({ status:'ERROR', error:'INJECTED_QUERY_FAILURE', data:[] });
  let backendState;
  try {
    ({ backendState } = await import('../../server/services/stateManager.js'));
    await assert.rejects(backendState._initPromise, /HYDRATION_FAILED: incidents/);
    assert.equal(backendState.isHydrated, false);
  } finally {
    incidentRepository.findAll = originalFindAll;
  }
  await backendState.init();
  assert.equal(backendState.isHydrated, true, 'hydration can recover when the query succeeds');
  await dbManager.close();
});
