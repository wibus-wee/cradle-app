import { randomUUID } from 'node:crypto'

import { Elysia } from 'elysia'
import { describe, expect, it } from 'vitest'

import { chatRuntime } from '.'

function createTestApp() {
  return new Elysia().use(chatRuntime)
}

describe('chat runtime route composition', () => {
  it('serves runtime catalog routes through the chat prefix', async () => {
    const app = createTestApp()
    const response = await app.handle(new Request('http://localhost/chat/runtimes'))
    const body = await response.json() as {
      items: Array<{
        runtimeKind: string
        stability?: string
        availability: string
        icon: { key?: string, svg?: string, url?: string }
        composer: {
          inputMode: string
          modelSelection: string
          thinking: string | { efforts: string[] }
        }
        slots: Array<{ id: string, name: string }>
        capabilities: {
          steer: string
          sessionModelSwitch: string
        } | null
        degradations?: Array<{ capability: string, status: string }>
      }>
    }

    expect(response.status).toBe(200)
    expect(body.items.find(item => item.runtimeKind === 'standard')).toBeUndefined()
    expect(body.items.find(item => item.runtimeKind === 'acp-chat')).toEqual(expect.objectContaining({
      stability: 'experimental',
      degradations: expect.arrayContaining([
        expect.objectContaining({
          capability: 'runtime',
          status: 'experimental',
        }),
      ]),
    }))
    expect(body.items.find(item => item.runtimeKind === 'codex')?.slots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'codex:goal', name: 'goal' }),
    ]))
    expect(body.items.find(item => item.runtimeKind === 'claude-agent')).toEqual(expect.objectContaining({
      composer: expect.objectContaining({
        inputMode: 'rich',
        modelSelection: 'alias-matrix',
        thinking: { efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
      }),
    }))
    expect(body.items.find(item => item.runtimeKind === 'cli-tui')).toEqual(expect.objectContaining({
      capabilities: null,
      composer: expect.objectContaining({
        inputMode: 'collapsed',
        modelSelection: 'none',
        thinking: 'unsupported',
      }),
    }))
  })

  it('does not serve draft capabilities for the removed Standard runtime', async () => {
    const app = createTestApp()
    const response = await app.handle(
      new Request('http://localhost/chat/draft-runtime-capabilities?runtimeKind=standard'),
    )
    const body = await response.text()

    expect(response.status).toBe(501)
    expect(body).toContain('Runtime is not available: standard')
  })

  it('serves server-owned composer draft routes through the chat prefix', async () => {
    const app = createTestApp()
    const surfaceId = encodeURIComponent(`new-chat:${randomUUID()}`)

    const writeResponse = await app.handle(new Request(`http://localhost/chat/composer-drafts/${surfaceId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        draft: {
          text: 'Draft question',
          contextParts: [],
          files: [],
          pastedTexts: [],
        },
      }),
    }))
    const written = await writeResponse.json() as {
      draft: { text: string } | null
      revision: number
      deletedAt: number | null
    }

    expect(writeResponse.status).toBe(200)
    expect(written).toEqual(expect.objectContaining({
      draft: { text: 'Draft question', contextParts: [], files: [], pastedTexts: [] },
      revision: 1,
      deletedAt: null,
    }))

    const readResponse = await app.handle(new Request(`http://localhost/chat/composer-drafts/${surfaceId}`))
    const read = await readResponse.json() as typeof written

    expect(readResponse.status).toBe(200)
    expect(read.draft).toEqual({ text: 'Draft question', contextParts: [], files: [], pastedTexts: [] })

    const deleteResponse = await app.handle(new Request(`http://localhost/chat/composer-drafts/${surfaceId}`, {
      method: 'DELETE',
    }))
    const deleted = await deleteResponse.json() as typeof written

    expect(deleteResponse.status).toBe(200)
    expect(deleted.draft).toBeNull()
    expect(deleted.revision).toBe(2)
    expect(deleted.deletedAt).not.toBeNull()
  })
})
