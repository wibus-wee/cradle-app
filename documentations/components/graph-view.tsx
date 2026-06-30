'use client'

import { forceCollide, forceLink, forceManyBody } from 'd3-force'
import { useRouter } from 'next/navigation'
import type { RefObject } from 'react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ForceGraphMethods,
  ForceGraphProps,
  LinkObject,
  NodeObject,
} from 'react-force-graph-2d'

import type { DocsGraph, DocsGraphLink, DocsGraphNode } from '@/lib/docs-graph'

export type GraphNode = NodeObject<DocsGraphNode>
export type GraphLink = LinkObject<DocsGraphNode, DocsGraphLink>

export interface GraphViewProps {
  graph: Pick<DocsGraph, 'nodes' | 'links'>
}

interface GraphDimensions {
  width: number
  height: number
}

const ForceGraph2D = lazy(
  () => import('react-force-graph-2d'),
) as typeof import('react-force-graph-2d').default

function graphEndpointId(endpoint: unknown) {
  if (typeof endpoint === 'object' && endpoint !== null && 'id' in endpoint) {
    const { id } = endpoint as { id?: string | number }

    return String(id)
  }

  return String(endpoint)
}

function compactLabel(label: string) {
  if (label.length <= 24) {
    return label
  }

  return `${label.slice(0, 21)}...`
}

function GraphFallback() {
  return (
    <div className="flex h-full min-h-[28rem] items-center justify-center bg-fd-muted/30 px-6 text-center">
      <p className="m-0 max-w-sm text-sm leading-6 text-fd-muted-foreground">
        正在载入可交互文档图谱...
      </p>
    </div>
  )
}

export function GraphView(props: GraphViewProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isMounted, setIsMounted] = useState(false)
  const [dimensions, setDimensions] = useState<GraphDimensions | null>(null)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    const element = ref.current

    if (!element) {
      return
    }

    const updateDimensions = () => {
      const rect = element.getBoundingClientRect()

      setDimensions({
        width: Math.max(280, Math.round(rect.width)),
        height: Math.max(420, Math.round(rect.height)),
      })
    }

    updateDimensions()

    const observer = new ResizeObserver(updateDimensions)
    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <div
      ref={ref}
      className="relative h-[30rem] overflow-hidden rounded-lg border border-fd-border bg-fd-background shadow-sm sm:h-[34rem] [&_canvas]:size-full"
    >
      {isMounted && dimensions
? (
        <Suspense fallback={<GraphFallback />}>
          <ClientGraph {...props} containerRef={ref} dimensions={dimensions} />
        </Suspense>
      )
: (
        <GraphFallback />
      )}
    </div>
  )
}

function ClientGraph({
  containerRef,
  dimensions,
  graph,
}: GraphViewProps & {
  containerRef: RefObject<HTMLDivElement | null>
  dimensions: GraphDimensions
}) {
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined)
  const hoveredRef = useRef<GraphNode | null>(null)
  const router = useRouter()
  const [tooltip, setTooltip] = useState<{
    x: number
    y: number
    title: string
    description?: string
    inboundCount: number
    outboundCount: number
  } | null>(null)

  const enrichedGraph = useMemo(() => {
    const nodes = graph.nodes.map(node => ({
      ...node,
      neighbors: [] as string[],
    }))
    const links = graph.links.map(link => ({ ...link }))
    const neighbors = new Map<string, Set<string>>()

    for (const node of nodes) {
      neighbors.set(node.id, new Set<string>())
    }

    for (const link of links) {
      neighbors.get(String(link.source))?.add(String(link.target))
      neighbors.get(String(link.target))?.add(String(link.source))
    }

    return {
      nodes: nodes.map(node => ({
        ...node,
        neighbors: Array.from(neighbors.get(node.id) ?? []),
      })),
      links,
    }
  }, [graph])

  const handleNodeHover = (node: GraphNode | null) => {
    const forceGraph = graphRef.current

    hoveredRef.current = node

    if (!forceGraph || !node) {
      setTooltip(null)
      return
    }

    const coords = forceGraph.graph2ScreenCoords(node.x ?? 0, node.y ?? 0)

    setTooltip({
      x: coords.x + 12,
      y: coords.y + 12,
      title: node.text,
      description: node.description,
      inboundCount: node.inboundCount,
      outboundCount: node.outboundCount,
    })
  }

  const nodeCanvasObject: ForceGraphProps<DocsGraphNode, DocsGraphLink>['nodeCanvasObject'] = (
    node,
    ctx,
  ) => {
    const container = containerRef.current

    if (!container) {
      return
    }

    const style = getComputedStyle(container)
    const radius = 5.5
    const fontSize = 12
    const nodeId = String(node.id)
    const hoverNode = hoveredRef.current
    const isActive
      = hoverNode?.id === node.id || hoverNode?.neighbors?.includes(nodeId) || hoverNode === null

    ctx.beginPath()
    ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI, false)
    ctx.fillStyle = isActive
      ? style.getPropertyValue('--color-fd-primary')
      : 'color-mix(in oklab, currentColor 22%, transparent)'
    ctx.fill()

    ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = style.getPropertyValue('color')
    ctx.fillText(compactLabel(node.text), node.x ?? 0, (node.y ?? 0) + radius + fontSize)
  }

  const linkColor = (link: GraphLink) => {
    const container = containerRef.current

    if (!container) {
      return '#999999'
    }

    const style = getComputedStyle(container)
    const hoverNode = hoveredRef.current
    const sourceId = graphEndpointId(link.source)
    const targetId = graphEndpointId(link.target)

    if (hoverNode && (hoverNode.id === sourceId || hoverNode.id === targetId)) {
      return style.getPropertyValue('--color-fd-primary')
    }

    return `color-mix(in oklab, ${style.getPropertyValue('--color-fd-muted-foreground')} 42%, transparent)`
  }

  return (
    <>
      <ForceGraph2D<DocsGraphNode, DocsGraphLink>
        width={dimensions.width}
        height={dimensions.height}
        ref={{
          get current() {
            return graphRef.current
          },
          set current(forceGraph) {
            graphRef.current = forceGraph

            if (forceGraph) {
              forceGraph.d3Force('link', forceLink().distance(116))
              forceGraph.d3Force('charge', forceManyBody().strength(-44))
              forceGraph.d3Force('collision', forceCollide(34))
              forceGraph.zoom(0.78)
            }
          },
        }}
        graphData={enrichedGraph}
        nodeCanvasObject={nodeCanvasObject}
        linkColor={linkColor}
        linkWidth={(link) => {
          const hoverNode = hoveredRef.current

          if (!hoverNode) {
            return 1.2
          }

          const sourceId = graphEndpointId(link.source)
          const targetId = graphEndpointId(link.target)

          return hoverNode.id === sourceId || hoverNode.id === targetId ? 2.4 : 0.8
        }}
        onNodeClick={(node) => {
          router.push(node.url)
        }}
        onNodeHover={handleNodeHover}
        cooldownTicks={80}
        enableNodeDrag
        enableZoomInteraction
      />
      {tooltip
? (
        <div
          className="pointer-events-none absolute max-w-72 rounded-lg border border-fd-border bg-fd-popover p-3 text-sm text-fd-popover-foreground shadow-lg"
          style={{ top: tooltip.y, left: tooltip.x }}
        >
          <p className="m-0 font-medium leading-5">{tooltip.title}</p>
          {tooltip.description
? (
            <p className="m-0 mt-1 text-xs leading-5 text-fd-muted-foreground">
              {tooltip.description}
            </p>
          )
: null}
          <p className="m-0 mt-2 text-xs leading-5 text-fd-muted-foreground">
            入站
{' '}
{tooltip.inboundCount}
{' '}
/ 出站
{' '}
{tooltip.outboundCount}
          </p>
        </div>
      )
: null}
    </>
  )
}
