import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.E2E_PORT || 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 10000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
      animations: 'disabled'
    }
  },
  fullyParallel: false, // deterministic sequential execution to avoid telemetry state collision
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // run single worker to share isolated local test backend cleanly
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }]
  ],
  outputDir: 'test-results',
  snapshotDir: './tests/e2e/__snapshots__',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 15000,
    colorScheme: 'dark', // default dark mode
    locale: 'id-ID',
    timezoneId: 'Asia/Jakarta'
  },
  projects: [
    {
      name: 'Desktop-Dark',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        colorScheme: 'dark'
      }
    },
    {
      name: 'Desktop-Light',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light'
      }
    },
    {
      name: 'Tablet',
      use: {
        viewport: { width: 768, height: 1024 },
        isMobile: false,
        hasTouch: true
      }
    },
    {
      name: 'Mobile',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
      }
    },
    {
      name: 'FullHD',
      use: {
        viewport: { width: 1920, height: 1080 }
      }
    }
  ],
  webServer: {
    command: 'node scripts/start-e2e-server.mjs',
    url: `${BASE_URL}/api/traffic`,
    timeout: 30000,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DEV_AUTO_LOGIN: 'false',
      OMNITRAF_RUNTIME_MODE: 'single',
      ALLOW_SQLJS_CLUSTER: 'true',
      E2E_TEST_RUN: 'true'
    }
  }
});
