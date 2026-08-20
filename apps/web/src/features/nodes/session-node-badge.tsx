import { ComputerLine as ComputerIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { useNodeDisplayName } from './use-nodes'

/**
 * Chat header / session badge: `On <Node name>` when the session executes on
 * a Fabric Node (`execution.kind === 'node'`). Renders nothing for local
 * sessions or unknown Node ids.
 */
export function SessionNodeBadge({ nodeId }: { nodeId: string | null | undefined }) {
  const { t } = useTranslation('nodes')
  const nodeName = useNodeDisplayName(nodeId)
  if (!nodeId || !nodeName) {
    return null
  }
  return (
    <span
      className="flex items-center gap-1 rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] text-muted-foreground"
      data-testid={`session-node-badge-${nodeId}`}
    >
      <ComputerIcon className="size-3" aria-hidden />
      {t('session.onNode', { nodeName })}
    </span>
  )
}
