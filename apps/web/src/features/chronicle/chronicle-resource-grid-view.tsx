import {
  ChipLine as ResourceIcon,
  DownloadLine as DownloadIcon,
  Refresh1Line as RecheckIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'

import { ChronicleEmptyState } from './chronicle-empty-state'
import { ChronicleResourceItemView } from './chronicle-resource-item-view'
import type { ChronicleModelResource } from './use-chronicle'

export interface ChronicleResourceGridViewProps {
  loading: boolean
  resources: ChronicleModelResource[]
  busy: boolean
  downloadProgress: Partial<
    Record<ChronicleModelResource['category'], number>
  >
  onInstallAll: () => void
  onReconcile: () => void
  onInstallResource: (
    category: ChronicleModelResource['category'],
  ) => Promise<ChronicleModelResource>
  onVerifyResource: (
    category: ChronicleModelResource['category'],
  ) => Promise<ChronicleModelResource>
}

export function ChronicleResourceGridView({
  loading,
  resources,
  busy,
  downloadProgress,
  onInstallAll,
  onReconcile,
  onInstallResource,
  onVerifyResource,
}: ChronicleResourceGridViewProps) {
  const { t } = useTranslation('chronicle')

  if (loading) {
    return (
      <ChronicleEmptyState
        icon={<ResourceIcon className="size-4" />}
        title={t('resources.loading')}
      />
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="default"
          size="default"
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={onInstallAll}
        >
          <DownloadIcon className="size-4" />
          {t('resources.installAll')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={onReconcile}
        >
          <RecheckIcon className="size-3.5" />
          {t('resources.recheck')}
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {resources.map(resource => (
          <ChronicleResourceItemView
            key={resource.category}
            resource={resource}
            busy={busy || resource.state === 'installing'}
            downloadProgress={downloadProgress[resource.category]}
            onInstall={onInstallResource}
            onVerify={onVerifyResource}
          />
        ))}
      </div>
    </div>
  )
}
