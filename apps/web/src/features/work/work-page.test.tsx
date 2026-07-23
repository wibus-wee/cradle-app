import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLayoutStore } from '~/store/layout'

import { WorkPage } from './work-page'

const mocks = vi.hoisted(() => ({
  updateSurfaceTitle: vi.fn(),
  getWorkDetail: vi.fn(),
}))

vi.mock('~/features/chat/session/chat-session-route-content', () => ({
  ChatSessionRouteContent: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="work-session-content">{sessionId}</div>
  ),
}))

vi.mock('~/navigation/surface-store', () => ({
  useSurfaceStore: <T,>(selector: (state: { updateSurfaceTitle: typeof mocks.updateSurfaceTitle }) => T) => selector({
    updateSurfaceTitle: mocks.updateSurfaceTitle,
  }),
}))

vi.mock('./use-work', () => ({
  useWorkDetail: () => ({
    data: mocks.getWorkDetail(),
    error: null,
  }),
}))

describe('workPage', () => {
  beforeEach(() => {
    mocks.updateSurfaceTitle.mockReset()
    mocks.getWorkDetail.mockReset().mockReturnValue({
      work: { title: 'Respect the user preference' },
      primaryThread: { id: 'session-1' },
    })
    useLayoutStore.setState({
      asideOpen: false,
      asideActiveTab: 'git',
    })
  })

  afterEach(cleanup)

  it('preserves the user right aside preference when opening a Work', () => {
    render(<WorkPage workId="work-1" />)

    expect(screen.getByTestId('work-session-content').textContent).toContain('session-1')
    expect(useLayoutStore.getState()).toMatchObject({
      asideOpen: false,
      asideActiveTab: 'git',
    })
  })
})
