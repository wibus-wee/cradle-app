import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  noExternal: [
    '@clack/prompts',
    '@cradle/plugin-sdk',
    'commander',
    'picocolors',
    'string-width',
    'table',
    'zod',
  ],
  splitting: false,
  outExtension: () => ({ js: '.cjs' }),
  banner: {
    js: '#!/usr/bin/env node',
  },
})
