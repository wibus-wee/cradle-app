import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SmartMentionList } from './smart-mention-list'
import type { SmartMentionItem } from './smart-mention-utils'

afterEach(() => {
  cleanup()
})

describe('smart mention list', () => {
  it('groups candidates by resource type and selects clicked items', () => {
    const issue: SmartMentionItem = {
      kind: 'issue',
      id: 'issue-1',
      label: 'CRA-007',
      title: 'Smart mentions',
      detail: 'Todo · high',
      workspaceId: 'workspace-1',
    }
    const session: SmartMentionItem = {
      kind: 'session',
      id: 'session-1',
      label: 'Planning',
      title: 'Planning session',
      detail: '12 messages',
      workspaceId: 'workspace-1',
    }
    const command = vi.fn()

    render(<SmartMentionList items={[session, issue]} command={command} />)

    expect(screen.getByText('Issue')).not.toBeNull()
    expect(screen.getByText('Session')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /CRA-007/i }))

    expect(command).toHaveBeenCalledWith(issue)
  })
})
