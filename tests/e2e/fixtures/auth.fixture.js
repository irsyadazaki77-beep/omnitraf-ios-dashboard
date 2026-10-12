import { TEST_USERS } from './test-data.js';

let authSequence = 0;

/**
 * Log in via API, verify the HttpOnly backend session, then seed the display
 * profile (which is not treated as proof of authentication).
 * @param {import('@playwright/test').Page} page
 * @param {'ADMIN'|'OPERATOR'|'VIEWER'} role
 */
export async function authenticateAs(page, role = 'ADMIN') {
  const user = TEST_USERS[role] || TEST_USERS.ADMIN;
  const testIp = `198.51.100.${(++authSequence % 250) + 1}`;
  
  // Direct API call from context to set HttpOnly session cookie
  const response = await page.request.post('/api/auth/login', {
    headers: { 'x-forwarded-for': testIp },
    data: {
      username: user.username,
      password: user.password
    }
  });

  const resJson = await response.json();
  if (!response.ok() || !resJson.success) {
    throw new Error(`Failed to authenticate as ${role}: ${JSON.stringify(resJson)}`);
  }

  const sessionCookie = (await page.context().cookies())
    .find((cookie) => cookie.name === 'omnitraf_session');
  if (!sessionCookie?.httpOnly) {
    throw new Error(`Login for ${role} did not set the HttpOnly backend session cookie.`);
  }
  const sessionResponse = await page.request.get('/api/auth/me', { headers: { 'x-forwarded-for': testIp } });
  const sessionJson = await sessionResponse.json();
  if (!sessionResponse.ok() || !sessionJson.success || sessionJson.data?.user?.role !== user.role) {
    throw new Error(`Backend session verification failed for ${role}: ${JSON.stringify(sessionJson)}`);
  }

  // Pre-seed localStorage user profile so UI immediately renders authenticated state
  await page.addInitScript((userData) => {
    try {
      localStorage.setItem('omnitraf_auth_user', JSON.stringify(userData));
    } catch (_) {}
  }, resJson.data.user);

  return resJson.data.user;
}

/**
 * Log out user via API
 * @param {import('@playwright/test').Page} page
 */
export async function logoutUser(page) {
  await page.request.post('/api/auth/logout');
  await page.evaluate(() => {
    if (location.origin !== 'null') localStorage.removeItem('omnitraf_auth_user');
  }).catch(() => {});
}
