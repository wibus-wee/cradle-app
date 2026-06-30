import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getServerUrl } from '~/lib/electron'
import { formatUptimeSeconds } from '~/lib/number-format'

const SERVER_BASE = getServerUrl()

interface HealthData {
  status: string
  uptime: number
  memory: {
    heapUsed: number
    heapTotal: number
    rss: number
    external: number
  }
  timestamp: number
}

export function HealthPanel() {
  const { t } = useTranslation('devtool')
  const [health, setHealth] = useState<HealthData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = async () => {
    try {
      const res = await fetch(`${SERVER_BASE}/health`)
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        return
      }
      const data: HealthData = await res.json()
      setHealth(data)
      setError(null)
    }
    catch (err) {
      setError(String(err))
    }
  }

  useEffect(() => {
    void fetchHealth()
    const id = setInterval(() => void fetchHealth(), 10_000)
    return () => clearInterval(id)
  }, [fetchHealth])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground/50">
        {t('health.fetchError')}
{' '}
{error}
      </div>
    )
  }

  if (!health) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground/50">
        {t('status.loading')}
      </div>
    )
  }

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
