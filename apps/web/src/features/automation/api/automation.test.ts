/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest'

import { getAutomations, postAutomations } from '~/api-gen/sdk.gen'

import { createAutomation, listAutomationDefinitions } from './automation'

vi.mock('~/api-gen/sdk.gen', () => ({
  getAutomations: vi.fn(),
  postAutomations: vi.fn(),
}))

describe('automation gateway', () => {
  it('uses one generated list operation with the workspace query', async () => {
    vi.mocked(getAutomations).mockResolvedValue({ data: [] } as never)

    await expect(listAutomationDefinitions('workspace-1')).resolves.toEqual([])

    expect(getAutomations).toHaveBeenCalledTimes(1)
    expect(getAutomations).toHaveBeenCalledWith({
      query: { workspaceId: 'workspace-1' },
      throwOnError: true,
    })
  })

  it('passes create bodies to the generated operation and propagates its errors', async () => {
    const input = {
      title: 'Daily review',
      trigger: { type: 'rrule' as const, rrule: 'FREQ=DAILY', timezone: 'UTC' },
      recipe: {
        kind: 'agent_task' as const,
        prompt: 'Review the workspace.',
        inputs: [],
        artifactRequests: [],
      },
    }
    const error = new Error('unauthorized')
    vi.mocked(postAutomations).mockRejectedValueOnce(error)

    await expect(createAutomation(input)).rejects.toThrow(error)
    expect(postAutomations).toHaveBeenCalledWith({ body: input, throwOnError: true })
  })
})
