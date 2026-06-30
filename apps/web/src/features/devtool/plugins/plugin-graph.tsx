/* Displays the plugin runtime topology with interactive React Flow inspection. */

import '@xyflow/react/dist/style.css'

import type { Edge, Node, NodeProps, NodeTypes, OnSelectionChangeParams } from '@xyflow/react'
import {
  Background,
  BackgroundVariant,
  // Controls,
  Handle,
  // MiniMap,
  Panel,
  Position,
  ReactFlow,
} from '@xyflow/react'
import { useState } from 'react'

import { cn } from '~/lib/cn'
import type { WebCommandRegistration, WebPanelRegistration } from '~/lib/plugin-store'

import type { PluginInfo } from './use-plugin-data'

type Layer = 'server' | 'web' | 'desktop'
type GraphNodeKind = 'runtime' | 'plugin' | 'contribution' | 'issue'

interface PluginGraphProps {
  plugins: PluginInfo[]
  panels: WebPanelRegistration[]
  commands: WebCommandRegistration[]
}

interface BaseNodeData extends Record<string, unknown> {
  kind: GraphNodeKind
  label: string
  detail?: string
  meta?: string
  status?: string
}

interface RuntimeNodeData extends BaseNodeData {
  kind: 'runtime'
  layer: Layer
  count: number
}

interface PluginNodeData extends BaseNodeData {
  kind: 'plugin'
  owner: string
  version: string
  activeLayers: Layer[]
  declaredCount: number
  runtimeCount: number
  permissionCount: number
  panelCount: number
  commandCount: number
  warningCount: number
}

interface ContributionNodeData extends BaseNodeData {
  kind: 'contribution'
  contributionType: 'declared' | 'runtime' | 'permission' | 'panel' | 'command'
  owner: string
  layer?: Layer
}

interface IssueNodeData extends BaseNodeData {
  kind: 'issue'
  owner: string
}

type PluginGraphNodeData = RuntimeNodeData | PluginNodeData | ContributionNodeData | IssueNodeData
type RuntimeFlowNode = Node<RuntimeNodeData, 'runtime'>
type PluginFlowNode = Node<PluginNodeData, 'plugin'>
type ContributionFlowNode = Node<ContributionNodeData, 'contribution'>
type IssueFlowNode = Node<IssueNodeData, 'issue'>
type PluginGraphNode = RuntimeFlowNode | PluginFlowNode | ContributionFlowNode | IssueFlowNode

const LAYERS: Array<{ key: Layer, label: string }> = [
  { key: 'server', label: 'Server' },
  { key: 'web', label: 'Web' },
  { key: 'desktop', label: 'Desktop' },
]

const LAYER_COLORS: Record<Layer, string> = {
  server: '#3b82f6',
  web: '#8b5cf6',
  desktop: '#f59e0b',
}

const LAYER_NODE_CLASSES: Record<
  Layer,
  {
    border: string
    selectedBorder: string
    selectedRing: string
    marker: string
    badge: string
  }
> = {
  server: {
    border: 'border-blue-500/40',
    selectedBorder: 'border-blue-500',
    selectedRing: 'shadow-[0_0_0_3px_rgba(59,130,246,0.14)]',
    marker: 'bg-blue-500',
    badge: 'bg-blue-500/15 text-blue-500',
  },
  web: {
    border: 'border-violet-500/40',
    selectedBorder: 'border-violet-500',
    selectedRing: 'shadow-[0_0_0_3px_rgba(139,92,246,0.14)]',
    marker: 'bg-violet-500',
    badge: 'bg-violet-500/15 text-violet-500',
  },
  desktop: {
    border: 'border-amber-500/40',
    selectedBorder: 'border-amber-500',
    selectedRing: 'shadow-[0_0_0_3px_rgba(245,158,11,0.16)]',
    marker: 'bg-amber-500',
    badge: 'bg-amber-500/15 text-amber-500',
  },
}

const CONTRIBUTION_COLORS: Record<ContributionNodeData['contributionType'], string> = {
  declared: '#06b6d4',
  runtime: '#14b8a6',
  permission: '#f97316',
  panel: '#a855f7',
  command: '#22c55e',
}

const CONTRIBUTION_NODE_CLASSES: Record<
  ContributionNodeData['contributionType'],
  {
    border: string
    selectedBorder: string
    selectedRing: string
    marker: string
    badge: string
  }
> = {
  declared: {
    border: 'border-cyan-500/40',
    selectedBorder: 'border-cyan-500',
    selectedRing: 'shadow-[0_0_0_3px_rgba(6,182,212,0.14)]',
    marker: 'bg-cyan-500',
    badge: 'bg-cyan-500/15 text-cyan-500',
  },
  runtime: {
    border: 'border-teal-500/40',
    selectedBorder: 'border-teal-500',
    selectedRing: 'shadow-[0_0_0_3px_rgba(20,184,166,0.14)]',
    marker: 'bg-teal-500',
    badge: 'bg-teal-500/15 text-teal-500',
  },
  permission: {
    border: 'border-orange-500/40',
    selectedBorder: 'border-orange-500',
    selectedRing: 'shadow-[0_0_0_3px_rgba(249,115,22,0.14)]',
    marker: 'bg-orange-500',
    badge: 'bg-orange-500/15 text-orange-500',
  },
  panel: {
    border: 'border-purple-500/40',
    selectedBorder: 'border-purple-500',
    selectedRing: 'shadow-[0_0_0_3px_rgba(168,85,247,0.14)]',
    marker: 'bg-purple-500',
    badge: 'bg-purple-500/15 text-purple-500',
  },
  command: {
    border: 'border-green-500/40',
    selectedBorder: 'border-green-500',
    selectedRing: 'shadow-[0_0_0_3px_rgba(34,197,94,0.14)]',
    marker: 'bg-green-500',
    badge: 'bg-green-500/15 text-green-500',
  },
}

function getPluginOwner(plugin: PluginInfo): string {
  return plugin.identity ?? plugin.name
}

function hasLayer(plugin: PluginInfo, layer: Layer): boolean {
  if (layer === 'server') { return plugin.hasServer }
  if (layer === 'web') { return plugin.hasWeb }
  return plugin.hasDesktop
}

function readLayerStatus(plugin: PluginInfo, layer: Layer): string {
  return plugin.layers?.[layer]?.status ?? (hasLayer(plugin, layer) ? 'discovered' : 'skipped')
}

function isConnectedLayer(plugin: PluginInfo, layer: Layer): boolean {
  return readLayerStatus(plugin, layer) !== 'skipped'
}

function readConnectedLayers(plugin: PluginInfo): Layer[] {
  const connectedLayers: Layer[] = []
  for (const layer of LAYERS) {
    if (isConnectedLayer(plugin, layer.key)) {
      connectedLayers.push(layer.key)
    }
  }
  return connectedLayers
}

function countDeclaredContributions(plugin: PluginInfo, layer: Layer): number {
  return (plugin.declaredCapabilities ?? []).filter(
    capability => capability.layer === layer || capability.layer === undefined,
  ).length
}

function countRuntimeContributions(plugin: PluginInfo, layer: Layer): number {
  return (plugin.capabilities ?? []).filter(capability => capability.layer === layer).length
}

function getInspectorMarkerClass(data: PluginGraphNodeData): string {
  if (data.kind === 'runtime') { return LAYER_NODE_CLASSES[data.layer].marker }
  if (data.kind === 'contribution') { return CONTRIBUTION_NODE_CLASSES[data.contributionType].marker }
  if (data.kind === 'issue') { return 'bg-amber-500' }
  return data.warningCount > 0 ? 'bg-amber-500' : 'bg-slate-500'
}

function RuntimeNode({ data, selected }: NodeProps<RuntimeFlowNode>) {
  const layerClasses = LAYER_NODE_CLASSES[data.layer]

  return (
    <div
      className={cn(
        'min-w-[142px] rounded-lg border bg-background px-3 py-2 shadow-sm transition-[border-color,box-shadow]',
        selected ? [layerClasses.selectedBorder, layerClasses.selectedRing] : layerClasses.border,
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('size-2 rounded-full', layerClasses.marker)} />
        <span className="font-mono text-[11px] font-medium text-foreground">{data.label}</span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
          {data.count}
        </span>
      </div>
      <div className="mt-1 font-mono text-[10px] text-muted-foreground">{data.detail}</div>
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  )
}

function PluginNode({ data, selected }: NodeProps<PluginFlowNode>) {
  const isActive = data.activeLayers.length > 0

  return (
    <div
      className={cn(
        'min-w-[230px] rounded-lg border bg-background px-3 py-2 shadow-sm transition-[border-color,box-shadow]',
        selected ? 'border-slate-400 shadow-[0_0_0_3px_rgba(148,163,184,0.18)]' : 'border-border',
      )}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            isActive ? 'bg-emerald-500' : 'bg-muted-foreground/30',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] font-medium text-foreground">
            {data.label}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">{data.owner}</div>
        </div>
        <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {data.version}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {data.activeLayers.map(layer => (
          <span
            key={layer}
            className={cn(
              'rounded-sm px-1.5 py-0.5 font-mono text-[9px]',
              LAYER_NODE_CLASSES[layer].badge,
            )}
          >
            {layer}
          </span>
        ))}
        {data.declaredCount > 0 && <GraphPill label={`${data.declaredCount} declared`} />}
        {data.runtimeCount > 0 && <GraphPill label={`${data.runtimeCount} runtime`} />}
        {data.permissionCount > 0 && <GraphPill label={`${data.permissionCount} permission`} />}
        {data.panelCount > 0 && <GraphPill label={`${data.panelCount} panel`} />}
        {data.commandCount > 0 && <GraphPill label={`${data.commandCount} command`} />}
        {data.warningCount > 0 && (
          <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 font-mono text-[9px] text-amber-500">
            {data.warningCount}
{' '}
warning
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="opacity-0" />
      <Handle type="source" position={Position.Bottom} id="issue" className="opacity-0" />
    </div>
  )
}

function ContributionNode({ data, selected }: NodeProps<ContributionFlowNode>) {
  const contributionClasses = CONTRIBUTION_NODE_CLASSES[data.contributionType]

  return (
    <div
      className={cn(
        'max-w-[230px] rounded-lg border bg-background px-3 py-2 shadow-sm transition-[border-color,box-shadow]',
        selected
          ? [contributionClasses.selectedBorder, contributionClasses.selectedRing]
          : contributionClasses.border,
      )}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div className="flex items-center gap-2">
        <span className={cn('size-2 rounded-full', contributionClasses.marker)} />
        <span className="truncate font-mono text-[11px] font-medium text-foreground">
          {data.label}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1">
        <span
          className={cn('rounded-sm px-1.5 py-0.5 font-mono text-[9px]', contributionClasses.badge)}
        >
          {data.contributionType}
        </span>
        {data.layer && (
          <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
            {data.layer}
          </span>
        )}
        {data.status && (
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            {data.status}
          </span>
        )}
      </div>
    </div>
  )
}

function IssueNode({ data, selected }: NodeProps<IssueFlowNode>) {
  return (
    <div
      className={cn(
        'max-w-[250px] rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-2 shadow-sm transition-[box-shadow]',
        selected && 'shadow-[0_0_0_3px_rgba(245,158,11,0.2)]',
      )}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div className="font-mono text-[11px] font-medium text-amber-500">{data.label}</div>
      {data.detail && (
        <div className="mt-1 line-clamp-2 font-mono text-[10px] text-amber-500/80">
          {data.detail}
        </div>
      )}
    </div>
  )
}

function GraphPill({ label }: { label: string }) {
  return (
    <span className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
      {label}
    </span>
  )
}

const nodeTypes = {
  runtime: RuntimeNode,
  plugin: PluginNode,
  contribution: ContributionNode,
  issue: IssueNode,
} satisfies NodeTypes

export function PluginGraph({ plugins, panels, commands }: PluginGraphProps) {
  const [selectedNode, setSelectedNode] = useState<PluginGraphNode | null>(null)

  const { nodes, edges, counts } = (() => {
    if (plugins.length === 0) {
      return {
        nodes: [] satisfies PluginGraphNode[],
        edges: [] satisfies Edge[],
        counts: { plugin: 0, contribution: 0, issue: 0 },
      }
    }

    const flowNodes: PluginGraphNode[] = []
    const flowEdges: Edge[] = []
    const rowGap = 122
    const pluginStartY = Math.max(16, 186 - ((plugins.length - 1) * rowGap) / 2)
    const layerCounts = Object.fromEntries(
      LAYERS.map(layer => [
        layer.key,
        plugins.filter(plugin => hasLayer(plugin, layer.key)).length,
      ]),
    ) as Record<Layer, number>

    for (let index = 0; index < LAYERS.length; index++) {
      const layer = LAYERS[index]
      flowNodes.push({
        id: `runtime:${layer.key}`,
        type: 'runtime',
        position: { x: 0, y: 56 + index * 126 },
        data: {
          kind: 'runtime',
          layer: layer.key,
          label: `${layer.label} Runtime`,
          detail: `${layerCounts[layer.key]} plugin layer${layerCounts[layer.key] === 1 ? '' : 's'}`,
          count: layerCounts[layer.key],
          status: layerCounts[layer.key] > 0 ? 'connected' : 'idle',
        },
      })
    }

    let contributionY = 0
    let issueY = 0

    for (let index = 0; index < plugins.length; index++) {
      const plugin = plugins[index]
      const owner = getPluginOwner(plugin)
      const activeLayers = readConnectedLayers(plugin)
      const ownedPanels = panels.filter(panel => panel.owner === owner)
      const ownedCommands = commands.filter(command => command.owner === owner)
      const declaredCount = plugin.declaredCapabilities?.length ?? 0
      const runtimeCount = plugin.capabilities?.length ?? 0
      const permissionCount = plugin.declaredPermissions?.length ?? 0
      const warningCount = plugin.warnings?.length ?? 0
      const pluginNodeId = `plugin:${owner}`

      flowNodes.push({
        id: pluginNodeId,
        type: 'plugin',
        position: { x: 292, y: pluginStartY + index * rowGap },
        data: {
          kind: 'plugin',
          owner,
          label: plugin.displayName || plugin.name,
          detail: plugin.description,
          meta: plugin.routeSegment ?? 'legacy route',
          version: plugin.version,
          activeLayers,
          declaredCount,
          runtimeCount,
          permissionCount,
          panelCount: ownedPanels.length,
          commandCount: ownedCommands.length,
          warningCount,
          status: activeLayers.length > 0 ? 'discovered' : 'inactive',
        },
      })

      for (const layer of LAYERS) {
        const status = readLayerStatus(plugin, layer.key)
        if (status === 'skipped') { continue }

        const declaredLayerCount = countDeclaredContributions(plugin, layer.key)
        const runtimeLayerCount = countRuntimeContributions(plugin, layer.key)
        const label = `${status} | d:${declaredLayerCount} r:${runtimeLayerCount}`

        flowEdges.push({
          id: `edge:runtime:${layer.key}:${owner}`,
          source: `runtime:${layer.key}`,
          target: pluginNodeId,
          type: 'smoothstep',
          animated: status === 'active',
          label,
          labelStyle: { fill: LAYER_COLORS[layer.key], fontFamily: 'monospace', fontSize: 9 },
          style: {
            stroke: `${LAYER_COLORS[layer.key]}99`,
            strokeWidth: status === 'active' ? 2 : 1.25,
          },
        })
      }

      const contributions: ContributionNodeData[] = [
        ...(plugin.declaredCapabilities ?? []).map(capability => ({
          kind: 'contribution' as const,
          contributionType: 'declared' as const,
          owner,
          label: capability.label ?? capability.type,
          detail: capability.localId,
          meta: capability.description,
          status: capability.type,
          layer: capability.layer,
        })),
        ...(plugin.capabilities ?? []).map(capability => ({
          kind: 'contribution' as const,
          contributionType: 'runtime' as const,
          owner,
          label: capability.label ?? capability.type,
          detail: capability.id,
          meta: capability.type,
          status: capability.status,
          layer: capability.layer,
        })),
        ...(plugin.declaredPermissions ?? []).map(permission => ({
          kind: 'contribution' as const,
          contributionType: 'permission' as const,
          owner,
          label: permission.label ?? permission.localId,
          detail: permission.localId,
          meta: permission.description,
          status: permission.required === true ? 'required' : 'optional',
        })),
        ...ownedPanels.map(panel => ({
          kind: 'contribution' as const,
          contributionType: 'panel' as const,
          owner,
          label: panel.title,
          detail: panel.localId,
          meta: panel.location ?? 'panel',
          status: panel.location ?? 'registered',
          layer: 'web' as const,
        })),
        ...ownedCommands.map(command => ({
          kind: 'contribution' as const,
          contributionType: 'command' as const,
          owner,
          label: command.title,
          detail: command.localId,
          meta: command.keybinding,
          status: command.keybinding ?? 'registered',
          layer: 'web' as const,
        })),
      ]

      for (const contribution of contributions) {
        const nodeId = `contribution:${contribution.contributionType}:${owner}:${contribution.detail ?? contribution.label}`
        flowNodes.push({
          id: nodeId,
          type: 'contribution',
          position: { x: 676, y: 18 + contributionY * 78 },
          data: contribution,
        })
        flowEdges.push({
          id: `edge:${pluginNodeId}:${nodeId}`,
          source: pluginNodeId,
          target: nodeId,
          type: 'smoothstep',
          style: {
            stroke: `${CONTRIBUTION_COLORS[contribution.contributionType]}88`,
            strokeWidth: 1.5,
          },
        })
        contributionY += 1
      }

      const layerErrors = LAYERS.flatMap((layer) => {
        const error = plugin.layers?.[layer.key]?.error
        return error ? [{ layer: layer.key, error }] : []
      })
      const issues = [
        ...(plugin.warnings ?? []).map(warning => ({ label: 'Warning', detail: warning })),
        ...layerErrors.map(({ layer, error }) => ({ label: `${layer} error`, detail: error })),
      ]

      for (const issue of issues) {
        const nodeId = `issue:${owner}:${issueY}`
        flowNodes.push({
          id: nodeId,
          type: 'issue',
          position: { x: 292, y: pluginStartY + plugins.length * rowGap + 58 + issueY * 82 },
          data: {
            kind: 'issue',
            owner,
            label: issue.label,
            detail: issue.detail,
            status: 'needs attention',
          },
        })
        flowEdges.push({
          id: `edge:${pluginNodeId}:${nodeId}`,
          source: pluginNodeId,
          sourceHandle: 'issue',
          target: nodeId,
          type: 'smoothstep',
          style: { stroke: '#f59e0b99', strokeWidth: 1.5, strokeDasharray: '5 4' },
        })
        issueY += 1
      }
    }

    return {
      nodes: flowNodes,
      edges: flowEdges,
      counts: {
        plugin: plugins.length,
        contribution: contributionY,
        issue: issueY,
      },
    }
  })()

  const handleSelectionChange = (params: OnSelectionChangeParams<PluginGraphNode>) => {
    setSelectedNode(params.nodes[0] ?? null)
  }

  if (plugins.length === 0) { return null }

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="font-mono text-[11px] font-medium text-foreground">Runtime Graph</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            Select nodes to inspect ownership, layer status, declared capabilities, runtime
            registrations, and issues.
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
          <GraphPill label={`${counts.plugin} plugins`} />
          <GraphPill label={`${counts.contribution} contributions`} />
          <GraphPill label={`${counts.issue} issues`} />
        </div>
      </div>
      <div className="h-[560px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onSelectionChange={handleSelectionChange}
          proOptions={{ hideAttribution: true }}
          fitView
          fitViewOptions={{ padding: 0.16 }}
          minZoom={0.3}
          maxZoom={1.5}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick={false}
          preventScrolling
          className="bg-muted/20"
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--color-border)"
          />
          {/* <Controls showInteractive={false} /> */}
          {/* <MiniMap
            pannable
            zoomable
            nodeColor={getNodeColor}
            nodeStrokeWidth={2}
            className="!bg-background/90"
          /> */}
          <Panel position="top-right" className="w-[292px]">
            <NodeInspector node={selectedNode} />
          </Panel>
        </ReactFlow>
      </div>
    </div>
  )
}

function NodeInspector({ node }: { node: PluginGraphNode | null }) {
  if (!node) {
    return (
      <div className="rounded-lg border border-border bg-background/95 p-3 shadow-sm backdrop-blur">
        <div className="font-mono text-[11px] font-medium text-foreground">No node selected</div>
        <div className="mt-1 font-mono text-[10px] text-muted-foreground">
          Click a runtime, plugin, registration, or issue node to inspect the graph evidence.
        </div>
      </div>
    )
  }

  const data = node.data

  return (
    <div className="rounded-lg border border-border bg-background/95 p-3 shadow-sm backdrop-blur">
      <div className="flex items-center gap-2">
        <span className={cn('size-2 rounded-full', getInspectorMarkerClass(data))} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[11px] font-medium text-foreground">
            {data.label}
          </div>
          <div className="font-mono text-[10px] text-muted-foreground">{data.kind}</div>
        </div>
      </div>
      <div className="mt-3 space-y-1 font-mono text-[10px]">
        <InspectorRow label="id" value={node.id} />
        {data.status && <InspectorRow label="status" value={data.status} />}
        {data.meta && <InspectorRow label="meta" value={data.meta} />}
        {data.detail && <InspectorRow label="detail" value={data.detail} />}
        {data.kind === 'plugin' && (
          <>
            <InspectorRow label="owner" value={data.owner} />
            <InspectorRow label="version" value={data.version} />
            <InspectorRow label="layers" value={data.activeLayers.join(', ') || 'none'} />
            <InspectorRow label="declared" value={String(data.declaredCount)} />
            <InspectorRow label="runtime" value={String(data.runtimeCount)} />
            <InspectorRow label="permissions" value={String(data.permissionCount)} />
            <InspectorRow label="panels" value={String(data.panelCount)} />
            <InspectorRow label="commands" value={String(data.commandCount)} />
            <InspectorRow label="warnings" value={String(data.warningCount)} />
          </>
        )}
        {data.kind === 'runtime' && (
          <>
            <InspectorRow label="layer" value={data.layer} />
            <InspectorRow label="count" value={String(data.count)} />
          </>
        )}
        {data.kind === 'contribution' && (
          <>
            <InspectorRow label="owner" value={data.owner} />
            <InspectorRow label="type" value={data.contributionType} />
            {data.layer && <InspectorRow label="layer" value={data.layer} />}
          </>
        )}
        {data.kind === 'issue' && <InspectorRow label="owner" value={data.owner} />}
      </div>
    </div>
  )
}

function InspectorRow({ label, value }: { label: string, value: string }) {
  return (
    <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all text-foreground">{value}</span>
    </div>
  )
}
