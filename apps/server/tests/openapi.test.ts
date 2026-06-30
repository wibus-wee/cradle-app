import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('openapi capability', () => {
  it('serves a generated OpenAPI document and Scalar UI with profile/provider schemas', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    const app = await createServerApp()

    try {
      const response = await app.handle(new Request('http://localhost/openapi.json'))
      expect(response.status).toBe(200)

      const serverEventsResponse = await app.handle(new Request('http://localhost/server/events'))
      expect(serverEventsResponse.status).toBe(404)

      const document = (await response.json()) as {
        openapi: string
        info: { title: string }
        paths: Record<
          string,
          Record<
            string,
            {
              parameters?: Array<{ name: string }>
              requestBody?: { content?: { 'application/json'?: { schema?: { $ref?: string } } } }
              responses?: Record<
                string,
                {
                  description?: string
                  content?: {
                    'application/json'?: { schema?: { $ref?: string } }
                    'text/event-stream'?: { example?: string, schema?: { type?: string } }
                  }
                }
              >
            }
          >
        >
        components?: { schemas?: Record<string, unknown> }
      }

      expect(document.openapi).toBe('3.0.3')
      expect(document.info.title).toBe('Cradle Server API')
      expect(document.paths['/health']?.get?.responses?.['200']).toBeTruthy()
      expect(document.paths['/health']?.get).toBeTruthy()
      expect(document.paths['/profiles/{id}']?.put?.requestBody).toBeTruthy()
      expect(document.paths['/sessions/{id}']?.patch).toBeTruthy()
      expect(document.paths['/sessions/{id}/title']).toBeUndefined()
      expect(document.paths['/sessions/{id}/toggle-pin']).toBeUndefined()
      expect(document.paths['/server/events']).toBeUndefined()
      expect(document.paths['/chat/sessions/{sessionId}/response']?.post).toBeTruthy()
      expect(
        document.paths['/chat/sessions/{sessionId}/response']?.post?.responses?.['200']?.content?.[
          'text/event-stream'
        ],
      ).toBeTruthy()
      expect(
        document.paths['/chat/sessions/{sessionId}/response']?.post?.responses?.['200']?.description,
      ).toContain('AI SDK UIMessageChunk')
      expect(
        String(
          document.paths['/chat/sessions/{sessionId}/response']?.post?.responses?.['200']
            ?.content?.['text/event-stream']
?.example ?? '',
        ),
      ).toContain('text-delta')
      expect(document.paths['/chat/sessions/{sessionId}/messages']?.get).toBeTruthy()
      expect(
        document.paths['/chat/sessions/{sessionId}/messages']?.get?.responses?.['200']?.content?.[
          'application/json'
        ]?.schema,
      ).toBeTruthy()
      expect(document.paths['/chat/sessions/{sessionId}/cancel']?.post).toBeTruthy()
      expect(document.paths['/chat/runs/{runId}']).toBeUndefined()
      expect(document.paths['/kanban/issues/{id}/move']).toBeUndefined()
      expect(document.paths['/kanban/issues/{id}']).toBeUndefined()
      expect(document.paths['/issues/{id}']).toBeTruthy()
      expect(document.paths['/issues/statuses']).toBeTruthy()
      expect(document.paths['/acp/agents/{agentId}/installation']?.put).toBeTruthy()
      expect(document.paths['/acp/agents/{agentId}/installation']?.delete).toBeTruthy()
      expect(document.paths['/acp/agents/{agentId}/install']).toBeUndefined()
      expect(document.paths['/acp/agents/{agentId}/cancel-install']).toBeUndefined()
      expect(document.paths['/kanban/issues/{id}/delegation']).toBeUndefined()
      expect(document.paths['/issues/{id}/delegation']).toBeTruthy()
      expect(document.paths['/issues/{id}/sessions']).toBeTruthy()
      expect(document.paths['/issues/{id}/agent-sessions']).toBeTruthy()
      expect(document.paths['/issue-agent/issues/{issueId}/delegation']).toBeUndefined()
      expect(document.paths['/issue-agent-sessions/{agentSessionId}/activities']).toBeTruthy()
      expect(document.paths['/agent-sessions/{agentSessionId}/activities']).toBeTruthy()
      expect(document.paths['/providers/models']?.post?.requestBody).toBeTruthy()
      expect(document.paths['/providers/health-check']).toBeUndefined()
      expect(document.components?.schemas).toBeTruthy()

      const aliasResponse = await app.handle(new Request('http://localhost/docs/openapi.json'))
      expect(aliasResponse.status).toBe(200)
      expect(await aliasResponse.json()).toEqual(document)

      const docsResponse = await app.handle(new Request('http://localhost/docs'))
      expect(docsResponse.status).toBe(200)
      expect(docsResponse.headers.get('content-type')).toContain('text/html')
      const html = await docsResponse.text()
      expect(html).toContain('api-reference')
    }
 finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
 else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
