/**
 * Import tab (Plan 031).
 *
 * The manual-paste escape hatch for plugins not in the marketplace:
 * paste a cradle:// link, GitHub URL, or npm package -> the shared InstallWizard
 * runs preview -> review (permissions + trust + checkboxes) -> install -> done
 * (per-plugin Enable + undo). No `ref`/`subPath`/`label` fields anywhere.
 *
 * The wizard views own their header (step indicator + title + description);
 * this tab only provides the page-level scroll container at full width.
 */
import { InstallWizard } from './install-wizard'

export function ImportTab() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        <InstallWizard mode="paste" />
      </div>
    </div>
  )
}
