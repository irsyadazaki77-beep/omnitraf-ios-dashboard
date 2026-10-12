import { writeFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { ROUTES } from './fixtures/test-data.js';
import { waitForViewReady, stabilizeVisualState } from './fixtures/simulation.fixture.js';

test('Phase 5 accessibility sweep across all views and themes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'Desktop-Dark', 'One stable Chromium profile scans every route in both themes.');
  test.setTimeout(240_000);
  await authenticateAs(page, 'OPERATOR');
  const findings = [];
  const blockingFindings = [];
  for (const route of ROUTES) {
    await page.goto(`/${route.path}`);
    await waitForViewReady(page, route.id);
    await stabilizeVisualState(page);
    for (const theme of ['dark', 'light']) {
      const isLight = await page.locator('body').evaluate((body) => body.classList.contains('theme-light'));
      if ((theme === 'light') !== isLight) {
        await page.locator('#themeToggle').click();
        await expect.poll(() => page.locator('body').evaluate((body) => body.classList.contains('theme-light'))).toBe(theme === 'light');
      }
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const violations = results.violations.map(({ id, impact, help, nodes }) => ({
        id, impact, help,
        nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary }))
      }));
      findings.push({ route: route.id, theme, violations });
      blockingFindings.push(...violations
        .filter(({ impact }) => impact === 'critical' || impact === 'serious')
        .map(({ id, impact, nodes }) => ({ route: route.id, theme, id, impact, nodes })));
    }
  }
  const json = JSON.stringify(findings, null, 2);
  await writeFile(testInfo.outputPath('phase5-accessibility-findings.json'), json, 'utf8');
  await testInfo.attach('phase5-accessibility-findings.json', { body: Buffer.from(json), contentType: 'application/json' });
  const summary = findings.map(({ route, theme, violations }) => `${route}/${theme}: ${violations.map(({ id, impact }) => `${id}(${impact})`).join(', ') || 'none'}`);
  console.log(summary.join('\n'));
  expect(blockingFindings, 'Serious/critical axe findings across all routes and themes').toEqual([]);
});

