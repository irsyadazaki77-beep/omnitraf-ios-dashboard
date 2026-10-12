import { test, expect } from '@playwright/test';
import { authenticateAs, logoutUser } from './fixtures/auth.fixture.js';
import { TEST_USERS } from './fixtures/test-data.js';

test('backend login rejects invalid credentials and logout invalidates the HttpOnly session', async ({ page }) => {
  const rejected = await page.request.post('/api/auth/login', {
    headers: { 'x-forwarded-for': '198.51.100.240' },
    data: { username: TEST_USERS.OPERATOR.username, password: 'not-the-password' }
  });
  expect(rejected.status()).toBe(401);

  await authenticateAs(page, 'OPERATOR');
  await logoutUser(page);
  const session = await page.request.get('/api/auth/me');
  expect(session.status()).toBe(401);
});

test('viewer cannot mutate simulation while operators and admins can control the simulator', async ({ page }) => {
  await authenticateAs(page, 'VIEWER');
  const forbidden = await page.request.post('/api/diagnostics/simulation/control', {
    data: { action: 'pause' }
  });
  expect(forbidden.status()).toBe(403);

  for (const role of ['OPERATOR', 'ADMIN']) {
    await authenticateAs(page, role);
    const pause = await page.request.post('/api/diagnostics/simulation/control', {
      data: { action: 'pause' }
    });
    expect(pause.status(), `${role} can pause simulation`).toBe(200);
    const resume = await page.request.post('/api/diagnostics/simulation/control', {
      data: { action: 'resume' }
    });
    expect(resume.status(), `${role} can resume simulation`).toBe(200);
  }
});
