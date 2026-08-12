import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkAttentionItem } from './use-work'
import { formatAttentionWaiting } from './work-attention-format'
import { WorkAttentionView } from './work-attention-view'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const failedItem: WorkAttentionItem = {
  id: 'work:work-1:handle_failure',
  category: 'handle_failure',
  risk: 'high',
  workId: 'work-1',
  workTitle: 'Repair failed Work',
  workspaceId: 'workspace-1',
  sessionId: 'session-1',
  runtimeKind: 'codex',
  providerTargetId: 'provider-1',
  agentId: null,
  state: 'failed',
  stateSinceAt: 10,
  waitingSeconds: 3_700,
  reason: 'The primary Agent Run ended in an error state.',
  authority: 'runtime_integration',
  nextAction: 'Open the Work, inspect the failed run, and retry or cancel it.',
  recovery: {
    level: 'resumable',
    evidence: 'The provider runtime has a durable session binding that supports resume.',
    lastHeartbeatAt: 12,
  },
}

afterEach(cleanup)

describe('work attention view', () => {
  it('opens the actionable Work without requiring terminal discovery', () => {
    const onOpenWork = vi.fn()
    render(
      <WorkAttentionView
        items={[failedItem]}
        isReady
        hasError={false}
        onOpenWork={onOpenWork}
        onRedetect={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Repair failed Work'))
    expect(onOpenWork).toHaveBeenCalledWith('work-1')
    expect(screen.getByText('1h')).toBeTruthy()
    expect(screen.getByText('authority.runtimeIntegration')).toBeTruthy()
  })

  it('offers explicit redetection for failed or unknown classifications', () => {
    const onRedetect = vi.fn()
    render(
      <WorkAttentionView
        items={[failedItem]}
        isReady
        hasError={false}
        onOpenWork={vi.fn()}
        onRedetect={onRedetect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'action.redetect' }))
    expect(onRedetect).toHaveBeenCalledWith('work-1')
  })

  it('distinguishes loading, empty, and failure states', () => {
    const { rerender } = render(
      <WorkAttentionView
        items={[]}
        isReady={false}
        hasError={false}
        onOpenWork={vi.fn()}
        onRedetect={vi.fn()}
      />,
    )
    expect(screen.getByTestId('work-attention').getAttribute('data-attention-ready')).toBe('false')

    rerender(
      <WorkAttentionView
        items={[]}
        isReady={false}
        hasError
        onOpenWork={vi.fn()}
        onRedetect={vi.fn()}
      />,
    )
    expect(screen.getByText('error.title')).toBeTruthy()
  })
})

describe('formatAttentionWaiting', () => {
  it.each([
    [0, '<1m'],
    [120, '2m'],
    [7_200, '2h'],
    [172_800, '2d'],
  ])('formats %i seconds as %s', (seconds, expected) => {
    expect(formatAttentionWaiting(seconds)).toBe(expected)
  })
})
