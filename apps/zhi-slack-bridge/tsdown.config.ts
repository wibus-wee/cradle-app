import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts', 'src/mcp-server.ts'],
  format: ['esm'],
  target: 'node22',
  fixedExtension: false,
  sourcemap: true,
  clean: true,
  dts: false,
})
