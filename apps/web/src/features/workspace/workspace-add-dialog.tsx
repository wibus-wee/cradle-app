import { useEffect, useMemo, useState } from 'react'

import type {
  NodeWorkspaceEntry,
  NodeWorkspaceTarget,
} from '~/features/nodes/node-grouping'
import { mergeNodeWorkspaceInventories } from '~/features/nodes/node-grouping'
import { NodeWorkspacePickerView } from '~/features/nodes/node-workspace-picker-view'
import { useConnectNode, useFabricMembership, useNodes, useNodeWorkspaces } from '~/features/nodes/use-nodes'
import type { CreateWorkspaceInput } from '~/features/workspace/use-workspace'
import { useWorkspaces } from '~/features/workspace/use-workspace'

import { WorkspaceAddDialogView } from './workspace-add-dialog-view'

export interface WorkspaceAddDialogProps {
  open: boolean
  creating: boolean
  onOpenChange: (open: boolean) => void
  onAddLocal: () => void
  /** Mount a workspace by locator (`nodeId` semantics). */
  onAddFromLocator: (input: CreateWorkspaceInput) => Promise<void>
}

export function WorkspaceAddDialog({
  open,
  creating,
  onOpenChange,
  onAddLocal,
  onAddFromLocator,
}: WorkspaceAddDialogProps) {
  const nodesQuery = useNodes()
  const nodes = useMemo(() => nodesQuery.data ?? [], [nodesQuery.data])
  const { workspaces } = useWorkspaces()
  const membershipQuery = useFabricMembership()
  const localNodeId = membershipQuery.data?.localNodeId ?? null
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [addingTargetKey, setAddingTargetKey] = useState<string | null>(null)
  const connectNode = useConnectNode()

  const remoteNodes = useMemo(
    () => nodes.filter(node => node.nodeId !== localNodeId),
    [localNodeId, nodes],
  )

  useEffect(() => {
    if (!open) {
      setSelectedNodeId(null)
      return
    }
    if (selectedNodeId !== null && !remoteNodes.some(node => node.nodeId === selectedNodeId)) {
      setSelectedNodeId(null)
    }
  }, [open, remoteNodes, selectedNodeId])

  const selectedNode = remoteNodes.find(node => node.nodeId === selectedNodeId) ?? null
  const nodeWorkspacesQuery = useNodeWorkspaces(selectedNode, open)

  const addedLocators = useMemo(
    () => workspaces.map(workspace => ({
      nodeId: workspace.locator.nodeId,
      path: workspace.locator.path,
    })),
    [workspaces],
  )
  const entries = useMemo(() => {
    if (!selectedNode) {
      return []
    }
    return mergeNodeWorkspaceInventories(
      [{
        node: { nodeId: selectedNode.nodeId, nodeName: selectedNode.displayName },
        workspaces: nodeWorkspacesQuery.data ?? [],
      }],
      addedLocators,
    )
  }, [addedLocators, nodeWorkspacesQuery.data, selectedNode])

  const handleAddWorkspace = async (entry: NodeWorkspaceEntry, target: NodeWorkspaceTarget) => {
    const targetKey = `${target.nodeId}:${target.path}`
    setAddingTargetKey(targetKey)
    try {
      await onAddFromLocator({
        name: entry.name,
        locator: {
          nodeId: target.nodeId,
          path: target.path,
          ...(target.kind ? { kind: target.kind } : {}),
          ...(target.sourceWorkspaceId ? { sourceWorkspaceId: target.sourceWorkspaceId } : {}),
        },
        ...(entry.originUrl || entry.repoRoot
          ? {
              gitIdentity: {
                ...(entry.originUrl ? { originUrl: entry.originUrl } : {}),
                ...(entry.repoRoot ? { repoRoot: entry.repoRoot } : {}),
              },
            }
          : {}),
      })
      onOpenChange(false)
    }
    finally {
      setAddingTargetKey(null)
    }
  }

  const nodePane = selectedNode
    ? (
        <NodeWorkspacePickerView
          entries={entries}
          loading={nodeWorkspacesQuery.isPending}
          selectedNodeOffline={selectedNode.status === 'offline'}
          addingTargetKey={addingTargetKey}
          onReconnect={() => {
            void connectNode
              .mutateAsync({ path: { nodeId: selectedNode.nodeId } })
              .then(() => nodeWorkspacesQuery.refetch())
              .catch(() => {})
          }}
          onAddWorkspace={(entry, target) => void handleAddWorkspace(entry, target)}
        />
      )
    : null

  return (
    <WorkspaceAddDialogView
      open={open}
      creating={creating}
      onOpenChange={onOpenChange}
      onAddLocal={onAddLocal}
      nodes={remoteNodes}
      selectedNodeId={selectedNodeId}
      onSelectNode={setSelectedNodeId}
      nodePane={nodePane}
    />
  )
}
