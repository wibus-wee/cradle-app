/** @type {import('@cucumber/cucumber').IConfiguration} */
export default {
  paths: ['e2e/src/features/**/*.feature'],
  import: ['e2e/src/steps/**/*.ts', 'e2e/src/support/**/*.ts'],
  format: ['progress-bar', 'html:e2e/artifacts/cucumber-report.html'],
  formatOptions: { snippetInterface: 'async-await' },
  requireModule: ['tsx'],
  parallel: 1,
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
