import { describe, expect, it } from 'vitest'

import { reconcileSessionNotesDraft } from './session-notes-state'

describe('session notes state', () => {
  it('accepts a server update when the draft is clean', () => {
    expect(reconcileSessionNotesDraft(
      'old server value',
      { sessionId: 'session-1', notes: 'old server value' },
      { sessionId: 'session-1', notes: 'new server value' },
    )).toBe('new server value')
  })

  it('preserves newer typing when an older save response arrives', () => {
    expect(reconcileSessionNotesDraft(
      'newer local draft',
      { sessionId: 'session-1', notes: 'old server value' },
      { sessionId: 'session-1', notes: 'earlier saved draft' },
    )).toBe('newer local draft')
  })

  it('hydrates the selected session even if the previous draft was dirty', () => {
    expect(reconcileSessionNotesDraft(
      'draft from another session',
      { sessionId: 'session-1', notes: 'old server value' },
      { sessionId: 'session-2', notes: 'selected session notes' },
    )).toBe('selected session notes')
  })
})
