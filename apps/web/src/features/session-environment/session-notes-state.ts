export interface SessionNotesSnapshot {
  sessionId: string
  notes: string
}

/**
 * Accept server updates only when the local draft still matches the snapshot
 * they replace. A user may keep typing while an earlier autosave is in flight;
 * that older response must not overwrite the newer local text.
 */
export function reconcileSessionNotesDraft(
  currentDraft: string,
  previousServer: SessionNotesSnapshot,
  nextServer: SessionNotesSnapshot,
): string {
  if (previousServer.sessionId !== nextServer.sessionId) {
    return nextServer.notes
  }
  return currentDraft === previousServer.notes ? nextServer.notes : currentDraft
}
