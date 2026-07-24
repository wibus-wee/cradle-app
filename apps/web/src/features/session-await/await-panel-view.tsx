import { AwaitSourceCardView } from './await-source-card-view'
import type { GitHubAwaitComposerViewProps } from './github-await-composer-view'
import { GitHubAwaitComposerView } from './github-await-composer-view'
import type {
  SessionAwait,
  SessionAwaitLiveStatusById,
} from './types'

export interface AwaitPanelViewProps {
  sessionSelected: boolean
  isReady: boolean
  awaits: readonly SessionAwait[]
  liveStatusByAwaitId: SessionAwaitLiveStatusById
  composer: GitHubAwaitComposerViewProps
  cancellingAwaitId?: string | null
  retryingAwaitId?: string | null
  bypassingCheck?: { awaitId: string, checkName: string } | null
  onCancel: (awaitId: string) => void
  onRetryDelivery: (awaitId: string) => void
  onBypassCheck: (awaitId: string, checkName: string) => void
}

export function AwaitPanelView({
  sessionSelected,
  isReady,
  awaits,
  liveStatusByAwaitId,
  composer,
  cancellingAwaitId,
  retryingAwaitId,
  bypassingCheck,
  onCancel,
  onRetryDelivery,
  onBypassCheck,
}: AwaitPanelViewProps) {
  if (!sessionSelected) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        data-testid="right-aside-await-panel"
        data-right-aside-await-ready="false"
      >
        <p className="text-[11px] text-muted-foreground">No session selected</p>
      </div>
    )
  }

  if (awaits.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center p-3"
        data-testid="right-aside-await-panel"
        data-right-aside-await-ready={isReady ? 'true' : 'false'}
      >
        <GitHubAwaitComposerView {...composer} />
      </div>
    )
  }

  const activeAwaits = awaits.filter(awaitRow => awaitRow.status === 'pending')
  const pastAwaits = awaits.filter(awaitRow => awaitRow.status !== 'pending')
  const renderAwait = (awaitRow: SessionAwait) => (
    <AwaitSourceCardView
      key={awaitRow.id}
      awaitRow={awaitRow}
      liveStatus={liveStatusByAwaitId.get(awaitRow.id)}
      isCancelling={cancellingAwaitId === awaitRow.id}
      isRetryingDelivery={retryingAwaitId === awaitRow.id}
      bypassingCheckName={bypassingCheck?.awaitId === awaitRow.id
        ? bypassingCheck.checkName
        : null}
      onCancel={onCancel}
      onRetryDelivery={onRetryDelivery}
      onBypassCheck={onBypassCheck}
    />
  )

  return (
    <div
      className="flex flex-1 flex-col gap-y-3 overflow-y-auto p-3"
      data-testid="right-aside-await-panel"
      data-right-aside-await-ready={isReady ? 'true' : 'false'}
    >
      {activeAwaits.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] text-muted-foreground/50">Active</span>
          {activeAwaits.map(renderAwait)}
        </div>
      )}
      {pastAwaits.length > 0 && (
        <div className="space-y-2">
          {pastAwaits.map(renderAwait)}
        </div>
      )}
    </div>
  )
}
