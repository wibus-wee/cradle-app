import { useQuery } from '@tanstack/react-query'

import type { ChatRuntimeCompactUiSlotState } from '../../capabilities/chat-capabilities'
import { getChatRuntimeContextUsage } from '../../capabilities/chat-capabilities'
import { ContextWindowViewerView } from '../views/context-window-viewer-view'

interface ContextWindowViewerContainerProps {
  sessionId: string | null
  compactState?: ChatRuntimeCompactUiSlotState | null
  className?: string
}

export function ContextWindowViewerContainer({
  sessionId,
  compactState,
  className,
}: ContextWindowViewerContainerProps) {
  const { data, isError, isLoading } = useQuery({
    queryKey: ['chat', 'context-window-usage', sessionId ?? 'no-session'],
    queryFn: ({ signal }) => getChatRuntimeContextUsage(sessionId!, signal),
    enabled: Boolean(sessionId),
    staleTime: 5_000,
    refetchInterval: compactState?.isCompactRelevant ? 5_000 : false,
    retry: false,
  })

  if (!sessionId) {
    return null
  }

  return (
    <ContextWindowViewerView
      usage={data?.usage ?? null}
      compactState={compactState}
      loadState={isLoading ? 'loading' : isError ? 'error' : 'ready'}
      className={className}
    />
  )
}
