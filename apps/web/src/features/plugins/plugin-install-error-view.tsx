import { Refresh2Line as RefreshIcon, WarningLine as WarningIcon } from '@mingcute/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'

interface PluginInstallErrorViewProps {
  message: string
  onRetry: () => void
  onCancel?: () => void
}

export function PluginInstallErrorView({
  message,
  onRetry,
  onCancel,
}: PluginInstallErrorViewProps) {
  const { t } = useTranslation('settings')
  const [detailsOpen, setDetailsOpen] = useState(false)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 animate-in fade-in slide-in-from-top-1 duration-200">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <WarningIcon className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h4 className="text-[15px] leading-6 font-semibold text-foreground text-balance">
            {t('plugins.add.error.title')}
          </h4>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground text-pretty">
            {message}
          </p>
          <button
            type="button"
            onClick={() => setDetailsOpen(open => !open)}
            className="mt-1.5 text-[11.5px] text-muted-foreground/80 transition-colors duration-150 hover:text-foreground"
          >
            {detailsOpen ? t('plugins.add.error.hideDetails') : t('plugins.add.error.showDetails')}
          </button>
          {detailsOpen && (
            <pre className="mt-2 max-h-32 overflow-auto rounded-lg border border-border/60 bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground animate-in fade-in duration-150">
              {message}
            </pre>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('plugins.add.cancel')}
          </Button>
        )}
        <Button onClick={onRetry} className="h-9 gap-1.5 px-4 text-[13px]">
          <RefreshIcon className="size-3.5" aria-hidden="true" />
          {t('plugins.add.retry')}
        </Button>
      </div>
    </div>
  )
}
