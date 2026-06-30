import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    'main': 'src/main.ts',
    'mcp-server': 'src/mcp-server.ts',
  },
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  dts: false,
})
