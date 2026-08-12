import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import type { WorkAttentionItem } from './use-work'
import { WorkAttentionView } from './work-attention-view'

const items: WorkAttentionItem[] = [
  {
    id: 'work:failed:handle_failure',
    category: 'handle_failure',
    risk: 'high',
    workId: 'failed',
    workTitle: 'Repair Linux packaging',
    workspaceId: 'workspace-cradle',
    sessionId: 'session-failed',
    runtimeKind: 'codex',
    providerTargetId: 'openai-codex',
    agentId: null,
    state: 'failed',
    stateSinceAt: 10,
    waitingSeconds: 7_200,
    reason: 'The primary Agent Run ended in an error state.',
    authority: 'runtime_integration',
    nextAction: 'Open the Work, inspect the failed run, and retry or cancel it.',
    recovery: {
      level: 'resumable',
      evidence: 'The provider runtime has a durable session binding that supports resume.',
      lastHeartbeatAt: 20,
    },
  },
  {
    id: 'work:review:review_work',
    category: 'review_work',
    risk: 'low',
    workId: 'review',
    workTitle: 'Explain Work delivery state',
    workspaceId: 'workspace-cradle',
    sessionId: 'session-review',
    runtimeKind: 'claude-agent',
    providerTargetId: 'anthropic',
    agentId: null,
    state: 'ready_for_review',
    stateSinceAt: 20,
    waitingSeconds: 900,
    reason: 'The Agent prepared a newer handoff than the last submitted pull request.',
    authority: 'runtime_integration',
    nextAction: 'Review the committed diff and publish or update the Draft pull request.',
    recovery: {
      level: 'reproducible',
      evidence: 'A healthy managed worktree retains the repository execution boundary.',
      lastHeartbeatAt: 20,
    },
  },
]

const meta = {
  title: 'Work/WorkAttentionView',
  component: WorkAttentionView,
  args: {
    items,
    isReady: true,
    hasError: false,
    redetectingWorkId: null,
    onOpenWork: fn(),
    onRedetect: fn(),
  },
} satisfies Meta<typeof WorkAttentionView>

export default meta
type Story = StoryObj<typeof meta>

export const ActionableWork: Story = {}

export const Empty: Story = {
  args: { items: [] },
}

export const Unavailable: Story = {
  args: { items: [], isReady: false, hasError: true },
}
