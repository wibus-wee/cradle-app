// Hosts the single What's New dialog instance and the after-update auto-open check.
import { useCallback, useEffect, useRef, useState } from 'react'

import { useDesktopPreferences } from '~/features/settings/use-desktop-preferences'
import { isElectron, nativeIpc } from '~/lib/electron'

import { useChangelogEntry, useChangelogIndex } from './use-changelog'
import { WhatsNewDialog } from './whats-new-dialog'
import { useWhatsNewDialogStore } from './whats-new-store'

export function WhatsNewContainer() {
  const { prefs, savePrefs } = useDesktopPreferences()
  const { data: index } = useChangelogIndex()
  const open = useWhatsNewDialogStore(s => s.open)
  const activeVersion = useWhatsNewDialogStore(s => s.activeVersion)
  const openDialog = useWhatsNewDialogStore(s => s.openDialog)
  const closeDialog = useWhatsNewDialogStore(s => s.closeDialog)
  const checkedRef = useRef(false)

  // After a desktop update, open the dialog once for the new version.
  useEffect(() => {
    if (checkedRef.current) { return }
    if (!prefs || !index || index.length === 0) { return }
    if (!isElectron || !nativeIpc) { return }

    checkedRef.current = true

    void nativeIpc.desktopUpdate.getStatus().then((status) => {
      const currentVersion = status.currentVersion
      if (!currentVersion || currentVersion === '0.0.0') { return }

      const lastSeen = prefs.lastSeenChangelogVersion

      // Only show if we haven't shown for this version yet
      if (lastSeen !== currentVersion) {
        if (index.some(e => e.version === currentVersion)) {
          openDialog(currentVersion)
        }
        // Persist even if no changelog entry exists, so we don't re-check
        void savePrefs({ lastSeenChangelogVersion: currentVersion })
      }
    }).catch(() => {
      // Silently ignore — don't block app startup
    })
  }, [prefs, index, savePrefs, openDialog])

  // Version shown in the dialog; rail clicks override locally, otherwise the
  // store-requested version, otherwise the latest entry.
  const [railVersion, setRailVersion] = useState<string | null>(null)

  // Reset the rail selection whenever the dialog is (re)opened.
  useEffect(() => {
    if (open) { setRailVersion(null) }
  }, [open, activeVersion])

  const entries = index ?? []
  const resolvedEntry = entries.find(e => e.version === (railVersion ?? activeVersion)) ?? entries[0] ?? null
  const { data: markdown } = useChangelogEntry(resolvedEntry?.version ?? null, resolvedEntry)

  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen) { closeDialog() }
  }, [closeDialog])

  if (!open || !resolvedEntry) { return null }

  return (
    <WhatsNewDialog
      open={open}
      onOpenChange={handleOpenChange}
      entries={entries}
      selectedVersion={resolvedEntry.version}
      onSelectVersion={setRailVersion}
      markdown={markdown ?? undefined}
    />
  )
}
