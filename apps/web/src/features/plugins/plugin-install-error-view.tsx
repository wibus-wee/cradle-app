import { Refresh2Line as RefreshIcon } from '@mingcute/react'
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

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-relaxed text-destructive/90">{message}</p>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('plugins.add.cancel')}
          </Button>
        )}
        <Button size="sm" onClick={onRetry} className="gap-1.5">
          <RefreshIcon className="size-3.5" aria-hidden="true" />
          {t('plugins.add.retry')}
        </Button>
      </div>
    </div>
  )
}
