import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  chronicleKnowledgeCards,
  chronicleMemories,
  providerTargets,
  sessions,
  workspaces,
} from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { insertMessageFixtures } from './helpers/message-fixture'
import { workspaceFixture } from './helpers/workspace-fixture'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('search capability', () => {
  it('searches titles, user content, and assistant message text with workspace filtering', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRootOne = makeTempDir('cradle-workspace-one-')
    const workspaceRootTwo = makeTempDir('cradle-workspace-two-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()

      const workspaceOneId = randomUUID()
      const workspaceTwoId = randomUUID()
      const providerTargetId = randomUUID()
      const sessionOneId = randomUUID()
      const sessionTwoId = randomUUID()
      const userMessageOneId = randomUUID()
      const assistantMessageId = randomUUID()
      const userMessageTwoId = randomUUID()
      const now = Math.floor(Date.now() / 1000)

      d.insert(workspaces).values([
        workspaceFixture({ id: workspaceOneId, name: 'Workspace One', path: workspaceRootOne }),
        workspaceFixture({ id: workspaceTwoId, name: 'Workspace Two', path: workspaceRootTwo }),
      ]).run()
      d.insert(providerTargets).values({
        id: providerTargetId,
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Search Provider',
      }).run()
      d.insert(sessions).values([
        { id: sessionOneId, workspaceId: workspaceOneId, title: 'Alpha deployment', providerTargetId },
        { id: sessionTwoId, workspaceId: workspaceTwoId, title: 'Beta planning', providerTargetId },
      ]).run()
      insertMessageFixtures(d, [
        {
          id: userMessageOneId,
          sessionId: sessionOneId,
          role: 'user',
          status: 'complete',
          content: 'The deployment log exploded yesterday',
          messageJson: JSON.stringify({
            id: userMessageOneId,
            role: 'user',
            parts: [{ type: 'text', text: 'The deployment log exploded yesterday' }],
          }),
          createdAt: now,
          updatedAt: now,
        },
        {
          id: assistantMessageId,
          sessionId: sessionOneId,
          role: 'assistant',
          status: 'complete',
          content: 'assistant solved the deployment issue',
          messageJson: JSON.stringify({
            id: assistantMessageId,
            role: 'assistant',
            parts: [{ type: 'text', text: 'assistant solved the deployment issue' }],
          }),
          createdAt: now + 1,
          updatedAt: now + 1,
        },
        {
          id: userMessageTwoId,
          sessionId: sessionTwoId,
          role: 'user',
          status: 'complete',
          content: 'Planning unrelated roadmap items',
          messageJson: JSON.stringify({
            id: userMessageTwoId,
            role: 'user',
            parts: [{ type: 'text', text: 'Planning unrelated roadmap items' }],
          }),
          createdAt: now + 2,
          updatedAt: now + 2,
        },
      ])

      const assistantSearch = await app.handle(new Request('http://localhost/search/threads?query=assistant%20solved'))
      expect(assistantSearch.status).toBe(200)
      const assistantHits = await assistantSearch.json()
      expect(assistantHits).toHaveLength(1)
      expect(assistantHits[0]).toEqual(expect.objectContaining({
        sessionId: sessionOneId,
        workspaceId: workspaceOneId,
        workspaceName: 'Workspace One',
        sessionTitle: 'Alpha deployment',
      }))
      expect(assistantHits[0].snippets).toEqual([
        expect.objectContaining({ messageRole: 'assistant' }),
      ])
      expect(assistantHits[0].snippets[0].text).toContain('assistant solved')

      const titleScoped = await app.handle(new Request(`http://localhost/search/threads?query=deployment&workspaceId=${encodeURIComponent(workspaceOneId)}`))
      expect(titleScoped.status).toBe(200)
      const scopedHits = await titleScoped.json()
      expect(scopedHits).toHaveLength(1)
      expect(scopedHits[0].sessionId).toBe(sessionOneId)

      const noMatchScoped = await app.handle(new Request(`http://localhost/search/threads?query=deployment&workspaceId=${encodeURIComponent(workspaceTwoId)}`))
      expect(noMatchScoped.status).toBe(200)
      expect(await noMatchScoped.json()).toEqual([])

      const deleteRes = await app.handle(new Request(`http://localhost/sessions/${sessionOneId}`, {
        method: 'DELETE',
      }))
      expect(deleteRes.status).toBe(200)

      const afterDeleteSearch = await app.handle(new Request('http://localhost/search/threads?query=assistant%20solved'))
      expect(afterDeleteSearch.status).toBe(200)
      expect(await afterDeleteSearch.json()).toEqual([])

      const invalidQuery = await app.handle(new Request('http://localhost/search/threads?query='))
      expect(invalidQuery.status).toBe(400)
      expect((await invalidQuery.json()).code).toBe('validation_error')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRootOne, { recursive: true, force: true })
      rmSync(workspaceRootTwo, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('filters thread search results by coarse session origin', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()

      const workspaceId = randomUUID()
      const providerTargetId = randomUUID()
      const reviewSessionId = randomUUID()
      const manualSessionId = randomUUID()
      const reviewMessageId = randomUUID()
      const manualMessageId = randomUUID()
      const now = Math.floor(Date.now() / 1000)

      d.insert(workspaces).values(workspaceFixture({
        id: workspaceId,
        name: 'Origin Search Workspace',
        path: workspaceRoot,
      })).run()
      d.insert(providerTargets).values({
        id: providerTargetId,
        kind: 'manual',
        providerKind: 'openai-compatible',
        displayName: 'Search Provider',
      }).run()
      d.insert(sessions).values([
        {
          id: reviewSessionId,
          workspaceId,
          title: 'Review generated walkthrough',
          origin: 'cradle-review',
          providerTargetId,
        },
        {
          id: manualSessionId,
          workspaceId,
          title: 'Manual generated walkthrough',
          providerTargetId,
        },
      ]).run()
      insertMessageFixtures(d, [
        {
          id: reviewMessageId,
          sessionId: reviewSessionId,
          role: 'assistant',
          status: 'complete',
          content: 'shared origin sentinel content',
          messageJson: JSON.stringify({
            id: reviewMessageId,
            role: 'assistant',
            parts: [{ type: 'text', text: 'shared origin sentinel content' }],
          }),
          createdAt: now,
          updatedAt: now,
        },
        {
          id: manualMessageId,
          sessionId: manualSessionId,
          role: 'assistant',
          status: 'complete',
          content: 'shared origin sentinel content',
          messageJson: JSON.stringify({
            id: manualMessageId,
            role: 'assistant',
            parts: [{ type: 'text', text: 'shared origin sentinel content' }],
          }),
          createdAt: now + 1,
          updatedAt: now + 1,
        },
      ])

      const reviewSearch = await app.handle(
        new Request('http://localhost/search/threads?query=shared%20origin%20sentinel&origin=cradle-review'),
      )
      expect(reviewSearch.status).toBe(200)
      expect(await reviewSearch.json()).toEqual([
        expect.objectContaining({
          sessionId: reviewSessionId,
          origin: 'cradle-review',
          sessionTitle: 'Review generated walkthrough',
        }),
      ])

      const manualSearch = await app.handle(
        new Request('http://localhost/search/threads?query=shared%20origin%20sentinel&origin=manual'),
      )
      expect(manualSearch.status).toBe(200)
      expect(await manualSearch.json()).toEqual([
        expect.objectContaining({
          sessionId: manualSessionId,
          origin: 'manual',
          sessionTitle: 'Manual generated walkthrough',
        }),
      ])
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('searches Chronicle memories and knowledge cards with workspace filtering', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRootOne = makeTempDir('cradle-workspace-one-')
    const workspaceRootTwo = makeTempDir('cradle-workspace-two-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()
      const workspaceOneId = randomUUID()
      const workspaceTwoId = randomUUID()
      const now = Math.floor(Date.now() / 1000)

      d.insert(workspaces).values([
        workspaceFixture({ id: workspaceOneId, name: 'Workspace One', path: workspaceRootOne }),
        workspaceFixture({ id: workspaceTwoId, name: 'Workspace Two', path: workspaceRootTwo }),
      ]).run()

      d.insert(chronicleMemories).values([
        {
          id: 'memory-alpha',
          sourceId: 'memory-alpha-source',
          contentHash: 'memory-alpha-hash',
          workspaceId: workspaceOneId,
          type: '10min',
          source: 'llm',
          content: '# Checkout incident\nProject Nebula checkout failed because the gateway token expired.',
          createdAt: now - 20,
          updatedAt: now - 10,
        },
        {
          id: 'memory-beta',
          sourceId: 'memory-beta-source',
          contentHash: 'memory-beta-hash',
          workspaceId: workspaceTwoId,
          type: '6h',
          source: 'imported',
          content: '# Design note\nUnrelated roadmap planning text.',
          createdAt: now - 30,
          updatedAt: now - 30,
        },
      ]).run()

      d.insert(chronicleKnowledgeCards).values([
        {
          id: 'knowledge-alpha',
          workspaceId: workspaceOneId,
          title: 'Nebula checkout gateway token',
          content: 'The durable fix is rotating the gateway token before checkout release windows.',
          cardType: 'decision',
          dimension: 'technical',
          confidenceBps: 9200,
          tagsJson: JSON.stringify(['nebula', 'checkout']),
          stableKey: 'knowledge-alpha',
          contentHash: 'knowledge-alpha-hash',
          version: 1,
          status: 'active',
          createdAt: now - 5,
          updatedAt: now,
        },
        {
          id: 'knowledge-deleted',
          workspaceId: workspaceOneId,
          title: 'Deleted checkout card',
          content: 'checkout content that should not be visible',
          cardType: 'fact',
          dimension: 'general',
          confidenceBps: 10000,
          stableKey: 'knowledge-deleted',
          contentHash: 'knowledge-deleted-hash',
          version: 1,
          status: 'deleted',
          createdAt: now - 4,
          updatedAt: now - 4,
        },
      ]).run()

      const searchRes = await app.handle(new Request('http://localhost/search/chronicle?query=checkout'))
      expect(searchRes.status).toBe(200)
      const hits = await searchRes.json()
      expect(hits.map((hit: { id: string }) => hit.id)).toEqual(['knowledge-alpha', 'memory-alpha'])
      expect(hits[0]).toEqual(expect.objectContaining({
        type: 'knowledge',
        workspaceId: workspaceOneId,
        workspaceName: 'Workspace One',
        cardType: 'decision',
        dimension: 'technical',
        status: 'active',
      }))
      expect(hits[1]).toEqual(expect.objectContaining({
        type: 'memory',
        workspaceId: workspaceOneId,
        memoryType: '10min',
        memorySource: 'llm',
      }))
      expect(hits.some((hit: { id: string }) => hit.id === 'knowledge-deleted')).toBe(false)

      const scopedMiss = await app.handle(new Request(`http://localhost/search/chronicle?query=checkout&workspaceId=${encodeURIComponent(workspaceTwoId)}`))
      expect(scopedMiss.status).toBe(200)
      expect(await scopedMiss.json()).toEqual([])

      const invalidQuery = await app.handle(new Request('http://localhost/search/chronicle?query='))
      expect(invalidQuery.status).toBe(400)
      expect((await invalidQuery.json()).code).toBe('validation_error')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRootOne, { recursive: true, force: true })
      rmSync(workspaceRootTwo, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
