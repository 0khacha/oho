import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  webServer: {
    command: 'node tests/server.mjs 4517',
    url: 'http://127.0.0.1:4517/onetrust.html',
    reuseExistingServer: true,
  },
});
