import { EyeLine as EyeIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { ChronicleAccessibilitySnapshotCardView } from './chronicle-accessibility-snapshot-card-view'
import { ChronicleEmptyState } from './chronicle-empty-state'
import type { ChronicleAccessibilitySnapshot } from './use-chronicle'

export interface ChronicleAccessibilitySnapshotListViewProps {
  loading: boolean
  snapshots: ChronicleAccessibilitySnapshot[]
}

export function ChronicleAccessibilitySnapshotListView({
  loading,
  snapshots,
}: ChronicleAccessibilitySnapshotListViewProps) {
  const { t } = useTranslation('chronicle')

  if (loading) {
    return (
      <ChronicleEmptyState
        icon={<EyeIcon className="size-4" />}
        title={t('advanced.accessibilitySnapshots.loading')}
      />
    )
  }

  if (snapshots.length === 0) {
    return (
      <ChronicleEmptyState
        icon={<EyeIcon className="size-4" />}
        title={t('advanced.accessibilitySnapshots.empty')}
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
      {snapshots.map(snapshot => (
        <ChronicleAccessibilitySnapshotCardView
          key={snapshot.id}
          snapshot={snapshot}
        />
      ))}
    </div>
  )
}
