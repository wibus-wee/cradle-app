import { useTranslation } from 'react-i18next'

import { Badge } from '~/components/ui/badge'

export interface ChronicleStatusBadgeViewProps {
  running: boolean
  available: boolean
}

export function ChronicleStatusBadgeView({
  running,
  available,
}: ChronicleStatusBadgeViewProps) {
  const { t } = useTranslation('chronicle')

  if (running) {
    return (
      <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        {t('common.status.running')}
      </Badge>
    )
  }

  if (available) {
    return <Badge variant="secondary">{t('common.status.ready')}</Badge>
  }

  return <Badge variant="outline">{t('common.status.notConfigured')}</Badge>
}
