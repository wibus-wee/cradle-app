import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  readActiveLayoutSlots,
  useLayoutSlotsStore,
} from '~/components/layout/layout-slots-context'
import { workSurfaceId } from '~/navigation/surface-identity'
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
    useLayoutSlotsStore.getState().resetSlots()
    useLayoutSlotsStore.getState().setSlotScope(
      workSurfaceId('work-1'),
      [workSurfaceId('work-1')],
    )
  })

  afterEach(cleanup)

  it('preserves the user right aside preference when opening a Work', () => {
    render(<WorkPage workId="work-1" />)

    expect(screen.getByTestId('work-session-content').textContent).toBe('session-1')
    expect(useLayoutStore.getState()).toMatchObject({
      asideOpen: false,
      asideActiveTab: 'git',
    })
  })

  it('renders no standalone loading chrome while the Work resolves', () => {
    mocks.getWorkDetail.mockReturnValue(undefined)

    const { container } = render(<WorkPage workId="work-1" />)

    expect(container.childElementCount).toBe(0)
    expect(readActiveLayoutSlots()).toMatchObject({
      asideSessionId: null,
      asideWorkspaceId: null,
      hasAside: false,
      hasPanel: false,
      hasBrowserPanel: false,
    })
  })
})
