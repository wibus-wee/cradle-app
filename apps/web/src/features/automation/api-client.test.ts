/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { listAutomationDefinitions, listAutomationRuns } from './api-client'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listAutomationDefinitions', () => {
  it('accepts server recipes keyed by providerTargetId', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)

      if (url.endsWith('/automations')) {
        return jsonResponse([{
          id: 'automation-1',
          workspaceId: 'workspace-1',
          title: 'Daily code review',
          description: 'Review active workspace changes.',
          enabled: true,
          trigger: {
            type: 'rrule',
            rrule: 'FREQ=DAILY;BYHOUR=9',
            timezone: 'Asia/Shanghai',
            misfirePolicy: 'skip',
          },
          recipe: {
            kind: 'agent_task',
            prompt: 'Review the current workspace changes.',
            inputs: [{
              type: 'text',
              name: 'scope',
              content: 'current workspace',
            }],
            artifactRequests: [{
              kind: 'markdown',
              name: 'review.md',
            }],
            providerTargetId: 'provider-target-1',
            runtimeKind: 'codex',
            modelId: 'gpt-5.4',
            thinkingEffort: 'high',
          },
          createdByKind: 'user',
          createdById: 'user-1',
          lastRunAt: null,
          nextRunAt: 1790000000000,
          createdAt: 1780000000000,
          updatedAt: 1780000000000,
        }])
      }

      if (url.endsWith('/automations/automation-1/runs')) {
        return jsonResponse([])
      }

      return new Response('not found', { status: 404 })
    })

    vi.stubGlobal('fetch', fetchMock)

    await expect(listAutomationDefinitions()).resolves.toMatchObject([{
      id: 'automation-1',
      recipe: {
        providerTargetId: 'provider-target-1',
      },
      latestRun: null,
    }])
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:21423/automations',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        }),
      }),
    )
  })

  it('passes workspaceId as query parameter when provided', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/automations?')) {
        return jsonResponse([])
      }
      return new Response('not found', { status: 404 })
    })

    vi.stubGlobal('fetch', fetchMock)

    await listAutomationDefinitions('ws-123')
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:21423/automations?workspaceId=ws-123',
      expect.anything(),
    )
  })
})

describe('listAutomationRuns', () => {
  it('accepts server run snapshots keyed by providerTargetId', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([{
      id: 'run-1',
      automationDefinitionId: 'automation-1',
      workspaceId: 'workspace-1',
      triggerType: 'manual',
      occurrenceKey: null,
      status: 'queued',
      triggerSnapshot: {
        type: 'rrule',
        rrule: 'FREQ=DAILY;BYHOUR=9',
        timezone: 'Asia/Shanghai',
      },
      recipeSnapshot: {
        kind: 'agent_task',
        prompt: 'Review the current workspace changes.',
        inputs: [],
        artifactRequests: [],
        providerTargetId: 'provider-target-1',
      },
      chatSessionId: null,
      backendRunId: null,
      artifactCount: 0,
      errorText: null,
      scheduledFor: null,
      claimedAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: 1780000000000,
      updatedAt: 1780000000000,
    }])))

    await expect(listAutomationRuns('automation-1')).resolves.toMatchObject([{
      id: 'run-1',
      recipeSnapshot: {
        providerTargetId: 'provider-target-1',
      },
    }])
  })
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
