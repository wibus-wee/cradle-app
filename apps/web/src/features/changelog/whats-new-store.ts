// Shared state for the What's New surfaces (dialog + corner popup).
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { persistStorage } from '~/store/persist-storage'

import type { ChangelogEntry } from './use-changelog'
import { useChangelogIndex } from './use-changelog'

// ── Dialog UI state ─────────────────────────────────────────────────────────

interface WhatsNewDialogState {
  open: boolean
  /** Version the dialog should display; null = latest index entry. */
  activeVersion: string | null
  openDialog: (version?: string) => void
  closeDialog: () => void
}

export const useWhatsNewDialogStore = create<WhatsNewDialogState>()(set => ({
  open: false,
  activeVersion: null,
  openDialog: version => set({ open: true, activeVersion: version ?? null }),
  closeDialog: () => set({ open: false }),
}))

/** Open the What's New dialog from non-React contexts (nav commands, menus). */
export function openWhatsNewDialog(version?: string): void {
  useWhatsNewDialogStore.getState().openDialog(version)
}

// ── Persisted announcement dismissal ────────────────────────────────────────

interface WhatsNewDismissalState {
  dismissedAnnouncements: string[]
  dismissAnnouncement: (version: string) => void
  dismissedTips: string[]
  dismissTip: (id: string) => void
}

export const useWhatsNewDismissalStore = create<WhatsNewDismissalState>()(
  persist(
    set => ({
      dismissedAnnouncements: [],
      dismissAnnouncement: version =>
        set(state => state.dismissedAnnouncements.includes(version)
          ? state
          : { dismissedAnnouncements: [...state.dismissedAnnouncements, version] }),
      dismissedTips: [],
      dismissTip: id =>
        set(state => state.dismissedTips.includes(id)
          ? state
          : { dismissedTips: [...state.dismissedTips, id] }),
    }),
    {
      name: 'cradle:whats-new:v1',
      storage: persistStorage,
      version: 1,
    },
  ),
)

// ── Pending announcement resolution ─────────────────────────────────────────

function todayLocalISODate(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Find the newest index entry that should be announced as a corner popup:
 * opted in via `announce`, past its `showAfter` (defaults to `date`), and
 * not yet dismissed. The index is sorted by date descending.
 */
export function findPendingAnnouncement(
  index: ChangelogEntry[] | undefined,
  dismissed: string[],
): ChangelogEntry | null {
  if (!index) { return null }
  const today = todayLocalISODate()
  return index.find(entry =>
    entry.announce === true
    && today >= (entry.showAfter ?? entry.date)
    && !dismissed.includes(entry.version)) ?? null
}

export function usePendingAnnouncement(): ChangelogEntry | null {
  const { data: index } = useChangelogIndex()
  const dismissed = useWhatsNewDismissalStore(s => s.dismissedAnnouncements)
  return findPendingAnnouncement(index, dismissed)
}
