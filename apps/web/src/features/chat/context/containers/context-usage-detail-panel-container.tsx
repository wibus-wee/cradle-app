import { useQuery } from '@tanstack/react-query'

import { useBrowserPanelStore } from '~/store/browser-panel'

import type {
  ChatRuntimeCompactUiSlotState,
  ChatRuntimeUsageUiSlotState,
} from '../../capabilities/chat-capabilities'
import { getChatRuntimeContextUsage } from '../../capabilities/chat-capabilities'
import { ContextUsageDetailPanelView } from '../views/context-usage-detail-panel-view'

interface ContextUsageDetailPanelContainerProps {
  sessionId: string | null
  compactState?: ChatRuntimeCompactUiSlotState | null
  runtimeUsageState?: ChatRuntimeUsageUiSlotState | null
  onClose: () => void
}

export function ContextUsageDetailPanelContainer({
  sessionId,
  compactState,
  runtimeUsageState,
  onClose,
}: ContextUsageDetailPanelContainerProps) {
  const openContextUsageReportTab = useBrowserPanelStore(
    state => state.openContextUsageReportTab,
  )
  const browserPanelOwnerId = useBrowserPanelStore(state => state.activeOwnerId)
  const { data, isError, isLoading } = useQuery({
    queryKey: ['chat', 'context-window-usage', sessionId ?? 'no-session'],
    queryFn: ({ signal }) => getChatRuntimeContextUsage(sessionId!, signal),
    enabled: Boolean(sessionId),
    staleTime: 5_000,
    refetchInterval: query => compactState?.isCompactRelevant && query.state.data?.usage !== null ? 5_000 : false,
    retry: false,
  })

  if (!sessionId) {
    return null
  }

  return (
    <ContextUsageDetailPanelView
      usage={data?.usage ?? null}
      compactState={compactState}
      runtimeUsageState={runtimeUsageState}
      loadState={isLoading ? 'loading' : isError ? 'error' : 'ready'}
      onClose={onClose}
      onOpenReport={() => {
        openContextUsageReportTab({ sessionId, ownerId: browserPanelOwnerId })
        onClose()
      }}
    />
  )
}
