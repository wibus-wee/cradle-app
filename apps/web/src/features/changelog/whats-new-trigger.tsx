// Startup trigger that shows the What's New dialog after a desktop update.
import { useCallback, useEffect, useRef, useState } from 'react'

import { useDesktopPreferences } from '~/features/settings/use-desktop-preferences'
import { isElectron, nativeIpc } from '~/lib/electron'

import type { ChangelogEntry } from './use-changelog'
import { useChangelogEntry, useChangelogIndex } from './use-changelog'
import { WhatsNewDialog } from './whats-new-dialog'

export function WhatsNewTrigger() {
  const { prefs, savePrefs } = useDesktopPreferences()
  const { data: index } = useChangelogIndex()
  const [targetVersion, setTargetVersion] = useState<string | null>(null)
  const [targetEntry, setTargetEntry] = useState<ChangelogEntry | null>(null)
  const [open, setOpen] = useState(false)
  const checkedRef = useRef(false)

  // Determine if we need to show the dialog
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
        // Check if we have a changelog entry for this version
        const entry = index.find(e => e.version === currentVersion)
        if (entry) {
          setTargetVersion(currentVersion)
          setTargetEntry(entry)
          setOpen(true)
        }
        // Persist even if no changelog entry exists, so we don't re-check
        void savePrefs({ lastSeenChangelogVersion: currentVersion })
      }
    }).catch(() => {
      // Silently ignore — don't block app startup
    })
  }, [prefs, index, savePrefs])

  // Fetch the markdown for the target version (locale-aware)
  const { data: markdown } = useChangelogEntry(targetVersion, targetEntry)

  const handleClose = useCallback((isOpen: boolean) => {
    setOpen(isOpen)
  }, [])

  if (!markdown || !targetEntry) { return null }

  return (
    <WhatsNewDialog
      open={open}
      onOpenChange={handleClose}
      version={targetEntry.version}
      date={targetEntry.date}
      title={targetEntry.title}
      markdown={markdown}
    />
  )
}
