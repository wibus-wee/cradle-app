import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

import { useObservabilityDevtoolStore } from './use-observability-events'

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 })
}

export function ObservabilityEventsTable() {
  const { t } = useTranslation('devtool')
  const entries = useObservabilityDevtoolStore(s => s.entries)
  const selectedIndex = useObservabilityDevtoolStore(s => s.selectedIndex)
  const selectIndex = useObservabilityDevtoolStore(s => s.selectIndex)
  const loading = useObservabilityDevtoolStore(s => s.loading)

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground/50">
        {t('status.loading')}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground/50">
        {t('observability.empty')}
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-left font-mono text-[11px]">
        <thead className="sticky top-0 bg-background">
          <tr className="border-b border-border text-muted-foreground">
            <th className="px-3 py-1.5 font-normal">{t('observability.kind')}</th>
            <th className="px-3 py-1.5 font-normal">{t('observability.time')}</th>
            <th className="px-3 py-1.5 font-normal">{t('observability.source')}</th>
            <th className="px-3 py-1.5 font-normal">{t('observability.code')}</th>
            <th className="px-3 py-1.5 font-normal">{t('observability.severity')}</th>
            <th className="px-3 py-1.5 font-normal">{t('observability.session')}</th>
            <th className="px-3 py-1.5 font-normal">{t('observability.run')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const timestamp = entry.kind === 'event'
              ? entry.payload.recordedAt
              : entry.payload.lastRecordedAt
            const payload = entry.payload
            return (
              <tr
                key={`${entry.kind}-${payload.id}`}
                onClick={() => selectIndex(index)}
                className={cn(
                  'cursor-pointer border-b border-border/50 transition-colors hover:bg-foreground/3',
                  selectedIndex === index && 'bg-foreground/5',
                )}
              >
                <td className="px-3 py-1">
                  {entry.kind === 'event' ? 'event' : 'incident'}
                </td>
                <td className="whitespace-nowrap px-3 py-1 text-muted-foreground">{formatTime(timestamp)}</td>
                <td className="px-3 py-1 text-muted-foreground">{payload.source}</td>
                <td className="px-3 py-1">{payload.code}</td>
                <td className="px-3 py-1">{payload.severity}</td>
                <td className="px-3 py-1 text-muted-foreground">{payload.chatSessionId?.slice(0, 8) ?? '—'}</td>
                <td className="px-3 py-1 text-muted-foreground">{payload.runId?.slice(0, 8) ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
