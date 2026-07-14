import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceSession } from '../use-session'
import { usePreviewCard } from './preview-card-context'
import { PreviewCardProvider } from './preview-card-provider'

vi.mock('./session/session-preview-card', () => ({
  SessionPreviewCard: ({
    target,
    open,
  }: {
    target: { session: { id: string } }
    open: boolean
  }) => (
    <div data-testid="preview-card" data-session-id={target.session.id} data-open={open} />
  ),
}))

function createSession(id: string): WorkspaceSession {
  return {
    id,
    workspaceId: 'workspace-1',
    title: id,
    providerTargetId: null,
    agentId: null,
    modelId: null,
    linkedIssueId: null,
    sessionGroupId: null,
    runtimeKind: 'codex',
    status: 'idle',
    pinned: 0,
    archivedAt: null,
    lastReadAt: null,
    createdAt: 0,
    updatedAt: 0,
    latestUserMessageAt: null,
    latestAssistantMessageAt: null,
    unread: false,
    listActivityAt: 0,
    origin: 'manual',
    isIsolated: false,
    worktreeId: null,
    worktreeBranch: null,
    execution: { kind: 'local' },
  }
}

function PreviewCardProbe() {
  const anchorRef = useRef<HTMLDivElement>(null)
  const previewCard = usePreviewCard()

  const show = (sessionId: string) => {
    if (anchorRef.current) {
      previewCard.show({
        kind: 'session',
        session: createSession(sessionId),
        anchor: anchorRef.current,
        placement: 'right',
      })
    }
  }

  return (
    <div ref={anchorRef}>
      <button type="button" onClick={() => show('session-a')}>Show A</button>
      <button type="button" onClick={previewCard.hide}>Hide</button>
      <button type="button" onClick={() => show('session-b')}>Show B</button>
    </div>
  )
}

describe('preview card provider', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps previews instant after crossing an item without a preview', () => {
    vi.useFakeTimers()
    render(
      <PreviewCardProvider>
        <PreviewCardProbe />
      </PreviewCardProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show A' }))
    expect(screen.getByTestId('preview-card').getAttribute('data-open')).toBe('false')

    act(() => vi.advanceTimersByTime(699))
    expect(screen.getByTestId('preview-card').getAttribute('data-open')).toBe('false')

    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByTestId('preview-card').getAttribute('data-open')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    act(() => vi.advanceTimersByTime(120))
    expect(screen.queryByTestId('preview-card')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show B' }))
    expect(screen.getByTestId('preview-card').getAttribute('data-session-id')).toBe('session-b')
    expect(screen.getByTestId('preview-card').getAttribute('data-open')).toBe('false')

    act(() => vi.advanceTimersByTime(700))
    expect(screen.getByTestId('preview-card').getAttribute('data-open')).toBe('true')
  })
})
