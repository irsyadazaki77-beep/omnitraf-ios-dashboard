import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test.describe('Deterministic traffic scenario intelligence', () => {
  test('scenario comparison is reproducible and validates horizon and seed', async ({ page }) => {
    await authenticateAs(page, 'OPERATOR');
    const url = '/api/prediction/v1/scenario-comparison?horizonMinutes=30&hour=17&seed=412';
    const firstResponse = await page.request.get(url);
    expect(firstResponse.status()).toBe(200);
    const first = await firstResponse.json();
    const secondResponse = await page.request.get(url);
    expect(secondResponse.status()).toBe(200);
    const second = await secondResponse.json();
    expect(first.data.sameInitialState).toBe(true);
    expect(first.data.seed).toBe(412);
    expect(first.data.horizonMinutes).toBe(30);
    expect(Object.keys(first.data.scenarios)).toEqual(['normal', 'rushHour', 'heavyRain', 'majorIncident', 'adaptiveSignals', 'emergencyGreenWave']);
    expect(first.data.scenarios).toEqual(second.data.scenarios);

    const invalidHorizon = await page.request.get('/api/prediction/v1/scenario-comparison?horizonMinutes=121&seed=412');
    expect(invalidHorizon.status()).toBe(422);
    const invalidSeed = await page.request.get('/api/prediction/v1/scenario-comparison?horizonMinutes=15&seed=-1');
    expect(invalidSeed.status()).toBe(422);
    const invalidHour = await page.request.get('/api/prediction/v1/scenario-comparison?horizonMinutes=15&seed=412&hour=24');
    expect(invalidHour.status()).toBe(422);
  });

  test('Analytics renders the model comparison after browser navigation', async ({ page }) => {
    await authenticateAs(page, 'OPERATOR');
    await page.goto('/#analytics');
    await waitForViewReady(page, 'view-analytics');
    await expect(page.getByRole('table', { name: 'Perbandingan skenario traffic simulasi' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Perbandingan skenario traffic simulasi' }).getByText('Emergency green wave')).toBeVisible();
  });
});
