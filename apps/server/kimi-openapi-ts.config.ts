import { defineConfig } from '@hey-api/openapi-ts'

export default defineConfig({
  input: './src/modules/chat-runtime-providers/kimi/protocol/openapi.json',
  output: {
    path: './src/modules/chat-runtime-providers/kimi/protocol/rest',
    clean: true,
    preferExportAll: true,
  },
  plugins: [
    '@hey-api/typescript',
    {
      name: '@hey-api/client-ofetch',
      exportFromIndex: true,
    },
    {
      name: 'zod',
      responses: false,
    },
    {
      name: '@hey-api/sdk',
      validator: true,
    },
  ],
})
