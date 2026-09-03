import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const tsxEntry = require.resolve('tsx')

/** @type {import('@cucumber/cucumber').IConfiguration} */
export default {
  paths: ['e2e/src/features/**/*.feature'],
  import: ['e2e/src/steps/**/*.ts', 'e2e/src/support/**/*.ts'],
  format: ['progress-bar', 'html:e2e/artifacts/cucumber-report.html'],
  formatOptions: { snippetInterface: 'async-await' },
  requireModule: [tsxEntry],
  /**
   * Each parallel worker boots its own managed server + web stack. Default is 1:
   * CI parallelizes the Claude/local lane while native Codex host traffic remains
   * serial. Opt in for local runs via CRADLE_E2E_PARALLEL.
   */
  parallel: Number(process.env.CRADLE_E2E_PARALLEL ?? 1),
  publishQuiet: true,
  retry: 0,
  timeout: 60_000,
  worldParameters: {
    /** Base URL for the web app */
    webUrl: process.env.CRADLE_WEB_URL ?? 'http://localhost:5174',
    /** Base URL for the API server */
    serverUrl: process.env.CRADLE_SERVER_URL ?? 'http://localhost:21423',
  },
}
