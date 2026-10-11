import { TEST_USERS } from './test-data.js';

/**
 * Log in via API to get cookie session and populate localStorage user profile
 * @param {import('@playwright/test').Page} page
 * @param {'ADMIN'|'OPERATOR'|'VIEWER'} role
 */
export async function authenticateAs(page, role = 'ADMIN') {
  const user = TEST_USERS[role] || TEST_USERS.ADMIN;
  
  // Direct API call from context to set HttpOnly session cookie
  const response = await page.request.post('/api/auth/login', {
    data: {
      username: user.username,
      password: user.password
    }
  });

  const resJson = await response.json();
  if (!response.ok() || !resJson.success) {
    throw new Error(`Failed to authenticate as ${role}: ${JSON.stringify(resJson)}`);
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
    localStorage.removeItem('omnitraf_auth_user');
  });
}
