// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { automationQueryKeys, useRunAutomationNow } from './use-automations'

const apiMocks = vi.hoisted(() => ({
  createAutomation: vi.fn(),
  listAutomationArtifacts: vi.fn(),
  listAutomationDefinitions: vi.fn(),
  listAutomationRuns: vi.fn(),
  listAutomationTriage: vi.fn(),
  runAutomationNow: vi.fn(),
  stopAutomationRun: vi.fn(),
  updateAutomation: vi.fn(),
  updateAutomationRunTriage: vi.fn(),
}))

vi.mock('./api/automation', () => apiMocks)

beforeEach(() => {
  apiMocks.runAutomationNow.mockReset().mockResolvedValue({ id: 'run-1' })
})

describe('automation query ownership', () => {
  it('keeps stable keys for all Automation consumers', () => {
    expect(automationQueryKeys.definitions('workspace-1')).toEqual([
      'automations',
      'definitions',
      { workspaceId: 'workspace-1' },
    ])
    expect(automationQueryKeys.triage(null)).toEqual([
      'automations',
      'triage',
      { workspaceId: null },
    ])
  })

  it('invalidates summary, history, artifacts, and triage after a run starts', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children)
    const { result } = renderHook(() => useRunAutomationNow(), { wrapper })

    await act(async () => {
      await result.current.mutateAsync('automation-1')
    })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: automationQueryKeys.definitionsRoot })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: automationQueryKeys.triage() })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: automationQueryKeys.runs('automation-1') })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: automationQueryKeys.artifacts('automation-1') })
  })
})
