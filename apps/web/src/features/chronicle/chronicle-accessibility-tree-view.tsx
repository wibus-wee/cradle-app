import { cn } from '~/lib/cn'

import {
  getChronicleAccessibilityTreeDepthClass,
  getChronicleAccessibilityTreeNodes,
} from './chronicle-accessibility-presenter'
import type { ChronicleAccessibilitySnapshot } from './use-chronicle'

export interface ChronicleAccessibilityTreeViewProps {
  tree: ChronicleAccessibilitySnapshot['tree']
}

export function ChronicleAccessibilityTreeView({
  tree,
}: ChronicleAccessibilityTreeViewProps) {
  const nodes = getChronicleAccessibilityTreeNodes(tree)

  if (nodes.length === 0) {
    return null
  }

  return (
    <div className="mt-2 space-y-1 border-t border-foreground/5 pt-2">
      {nodes.map(node => (
        <div
          key={node.path}
          className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground"
        >
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono">
            {node.role}
          </span>
          <span
            className={cn(
              'min-w-0 flex-1 truncate',
              getChronicleAccessibilityTreeDepthClass(node.depth),
            )}
          >
            {node.label || node.value || node.path}
          </span>
        </div>
      ))}
    </div>
  )
}
