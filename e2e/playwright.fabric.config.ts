import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './src/fabric',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [
    ['line'],
    ['html', { outputFolder: 'artifacts/fabric-report', open: 'never' }],
    ['./scripts/playwright-performance-reporter.cjs', {
      outputDir: 'artifacts/fabric-results/performance',
    }],
  ],
  outputDir: 'artifacts/fabric-results',
  use: {
    headless: !process.env.CRADLE_E2E_HEADED,
    viewport: { width: 1280, height: 800 },
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
})
