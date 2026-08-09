import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { getHealthOptions } from '~/api-gen/@tanstack/react-query.gen'
import { formatUptimeSeconds } from '~/lib/number-format'

export function HealthPanel() {
  const { t } = useTranslation('devtool')
  const healthQuery = useQuery({
    ...getHealthOptions(),
    refetchInterval: 10_000,
  })

  if (healthQuery.error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground/50">
        {t('health.fetchError')}
{' '}
        {healthQuery.error.message}
      </div>
    )
  }

  if (!healthQuery.data) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground/50">
        {t('status.loading')}
      </div>
    )
  }

  const health = healthQuery.data
  const rows: [string, string][] = [
    [t('health.status'), health.status],
    [t('health.uptime'), formatUptimeSeconds(health.uptime, { includeSeconds: true })],
    [t('health.heapUsed'), `${health.memory.heapUsed} MB`],
    [t('health.heapTotal'), `${health.memory.heapTotal} MB`],
    [t('health.rss'), `${health.memory.rss} MB`],
    [t('health.external'), `${health.memory.external} MB`],
    [t('health.timestamp'), new Date(health.timestamp).toLocaleTimeString('en-US', { hour12: false })],
  ]

  return (
    <div className="h-full overflow-auto p-4">
      <table className="w-full text-left font-mono text-[11px]">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-border">
              <td className="py-2 pr-6 text-muted-foreground">{label}</td>
              <td className="py-2 text-foreground">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
