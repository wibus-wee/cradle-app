import type { GetStorageOverviewResponse } from '~/api-gen/types.gen'

export type StorageCategoryId = GetStorageOverviewResponse['categories'][number]['id']
export type StorageSession = GetStorageOverviewResponse['sessions'][number]

export const categoryVisuals = {
  database: { bar: 'bg-chart-1', label: 'text-chart-1' },
  runtime: { bar: 'bg-chart-2', label: 'text-chart-2' },
  attachments: { bar: 'bg-chart-3', label: 'text-chart-3' },
  artifacts: { bar: 'bg-chart-4', label: 'text-chart-4' },
  terminal: { bar: 'bg-info', label: 'text-info' },
  diagnostics: { bar: 'bg-chart-5', label: 'text-chart-5' },
  other: { bar: 'bg-muted-foreground', label: 'text-muted-foreground' },
} satisfies Record<StorageCategoryId, { bar: string, label: string }>

export const sessionPartVisuals = [
  { id: 'local', field: 'localBytes' as const, bar: categoryVisuals.database.bar },
  { id: 'runtime', field: 'runtimeBytes' as const, bar: categoryVisuals.runtime.bar },
  { id: 'attachments', field: 'attachmentBytes' as const, bar: categoryVisuals.attachments.bar },
  { id: 'artifacts', field: 'artifactBytes' as const, bar: categoryVisuals.artifacts.bar },
  { id: 'terminal', field: 'terminalBytes' as const, bar: categoryVisuals.terminal.bar },
]

export type StorageSessionBytesField = 'localBytes' | 'runtimeBytes' | 'attachmentBytes' | 'artifactBytes' | 'terminalBytes'

export const categorySessionField: Record<StorageCategoryId, StorageSessionBytesField | null> = {
  database: 'localBytes',
  runtime: 'runtimeBytes',
  attachments: 'attachmentBytes',
  artifacts: 'artifactBytes',
  terminal: 'terminalBytes',
  diagnostics: null,
  other: null,
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B` }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export function getSessionTotalBytes(session: StorageSession): number {
  return sessionPartVisuals.reduce((sum, part) => sum + session[part.field], 0)
}
