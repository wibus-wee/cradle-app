import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatTimeOnly } from '~/lib/format-time'
import { formatBytesAsMegabytes } from '~/lib/number-format'
import { getPerfSnapshots, getWebVitals } from '~/lib/perf-monitor'

export function MemoryPanel() {
  const { t } = useTranslation('devtool')
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 5_000)
    return () => clearInterval(id)
  }, [])

  const snapshots = getPerfSnapshots()
  const vitals = getWebVitals()
  const latest = snapshots.at(-1)
  const recentSnapshots = snapshots.slice(-10)

  return (
    <div className="h-full overflow-auto p-4 font-mono text-[11px]">
      <div className="mb-4">
        <div className="mb-2 text-xs text-muted-foreground">{t('memory.currentHeapUsage')}</div>
        {latest
          ? (
              <table className="w-full text-left">
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-1.5 pr-6 text-muted-foreground">{t('memory.heapUsed')}</td>
                    <td className="py-1.5 text-foreground">
{formatBytesAsMegabytes(latest.heapUsed)}
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-1.5 pr-6 text-muted-foreground">{t('memory.heapTotal')}</td>
                    <td className="py-1.5 text-foreground">
{formatBytesAsMegabytes(latest.heapTotal)}
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-1.5 pr-6 text-muted-foreground">{t('memory.heapLimit')}</td>
                    <td className="py-1.5 text-foreground">
{formatBytesAsMegabytes(latest.heapLimit)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )
          : <div className="text-muted-foreground/50">{t('memory.unavailable')}</div>}
      </div>

      {recentSnapshots.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-xs text-muted-foreground">
            {t('memory.trend', { count: recentSnapshots.length })}
          </div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1.5 pr-3 font-normal">{t('memory.time')}</th>
                <th className="py-1.5 pr-3 font-normal">{t('memory.heapUsed')}</th>
                <th className="py-1.5 font-normal">{t('memory.heapTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {recentSnapshots.map(snap => (
                <tr key={snap.timestamp} className="border-b border-border">
                  <td className="py-1 pr-3 text-muted-foreground">
                    {formatTimeOnly(snap.timestamp)}
                  </td>
                  <td className="py-1 pr-3">
{formatBytesAsMegabytes(snap.heapUsed)}
                  </td>
                  <td className="py-1">
{formatBytesAsMegabytes(snap.heapTotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {vitals.length > 0 && (
        <div>
          <div className="mb-2 text-xs text-muted-foreground">{t('memory.webVitals')}</div>
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1.5 pr-3 font-normal">{t('memory.metric')}</th>
                <th className="py-1.5 pr-3 font-normal">{t('memory.value')}</th>
                <th className="py-1.5 font-normal">{t('memory.rating')}</th>
              </tr>
            </thead>
            <tbody>
              {vitals.map(v => (
                <tr key={v.name} className="border-b border-border">
                  <td className="py-1 pr-3 text-muted-foreground">{v.name}</td>
                  <td className="py-1 pr-3">{v.value.toFixed(2)}</td>
                  <td className="py-1">{v.rating}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!latest && vitals.length === 0 && (
        <div className="text-xs text-muted-foreground/50">
          {t('memory.empty')}
        </div>
      )}
    </div>
  )
}
