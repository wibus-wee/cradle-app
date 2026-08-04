import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: '../server/openapi.json',
  output: {
    path: './src/api-gen',
    clean: true,
    preferExportAll: true,
  },
  plugins: [
    {
      name: '@hey-api/typescript',
      enums: 'javascript',
    },
  ],
})
