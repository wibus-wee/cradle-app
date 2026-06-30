import { openapi } from '@elysia/openapi'
import type { AnyElysia } from 'elysia'

export const OPENAPI_JSON_PATH = '/openapi.json'
export const OPENAPI_JSON_ALIAS_PATH = '/docs/openapi.json'
export const OPENAPI_DOCS_PATH = '/docs'

export function createOpenApiPlugin() {
  return openapi({
    path: OPENAPI_DOCS_PATH,
    specPath: OPENAPI_JSON_PATH,
    provider: 'scalar',
    documentation: {
      info: {
        title: 'Cradle Server API',
        version: '0.0.1',
        description: 'Local-first HTTP API for Cradle server capabilities.',
      },
      servers: [{ url: '/' }],
    },
  })
}

export function registerOpenApiAlias(app: AnyElysia): void {
  app.get(OPENAPI_JSON_ALIAS_PATH, ({ request }) => {
    return app.handle(new Request(new URL(OPENAPI_JSON_PATH, request.url)))
  })
}
