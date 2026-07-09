/**
 * Import tab (Plan 031).
 *
 * The manual-paste escape hatch for plugins not in the marketplace:
 * paste a cradle:// link, GitHub URL, or npm package -> the shared InstallWizard
 * runs preview -> review (permissions + trust + checkboxes) -> install -> done
 * (per-plugin Enable + undo). No `ref`/`subPath`/`label` fields anywhere.
 */
import { useTranslation } from 'react-i18next'

import { InstallWizard } from './install-wizard'

export function ImportTab() {
  const { t } = useTranslation('settings')

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="px-1 pb-3">
        <h2 className="text-[13px] font-medium text-foreground">{t('plugins.add.title')}</h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{t('plugins.add.description')}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4">
        <div className="mx-auto max-w-xl rounded-xl border border-border/60 bg-card p-4">
          <InstallWizard mode="paste" />
        </div>
      </div>
    </div>
  )
}
