import { writeFileSync } from 'node:fs'

writeFileSync('e2e/cucumber-ci.mjs', [
  'import baseConfig from \'./cucumber.mjs\'',
  '',
  'export default {',
  '  ...baseConfig,',
  '  format: [],',
  '  formatOptions: {',
  '    ...baseConfig.formatOptions,',
  '    printAttachments: false,',
  '  },',
  '}',
  '',
].join('\n'))
