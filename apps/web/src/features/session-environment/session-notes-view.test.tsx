import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SessionNotesView } from './session-notes-view'

afterEach(cleanup)

const statusLabels = {
  saved: 'Saved',
  unsaved: 'Not saved yet',
  saving: 'Saving…',
  error: 'Save failed',
}

describe('session notes view', () => {
  it('announces autosave state and forwards edits', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <SessionNotesView
        label="Notes"
        value="Initial"
        placeholder="Keep notes here"
        status="unsaved"
        statusLabels={statusLabels}
        onChange={onChange}
      />,
    )

    expect(screen.getByRole('status').textContent).toBe('Not saved yet')
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'Updated' } })
    expect(onChange).toHaveBeenCalledWith('Updated')

    rerender(
      <SessionNotesView
        label="Notes"
        value="Updated"
        placeholder="Keep notes here"
        status="saved"
        statusLabels={statusLabels}
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('status').textContent).toBe('Saved')
  })
})
