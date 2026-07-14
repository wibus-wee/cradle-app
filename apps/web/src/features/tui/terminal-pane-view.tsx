import {
  CloseLine as XIcon,
  Columns2Line as SplitRightIcon,
  PlusLine as PlusIcon,
  Rows2Line as SplitDownIcon,
  TerminalBoxLine as TerminalIcon,
} from '@mingcute/react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

import { ShellView } from './shell-view'
import type { TerminalMetadata } from './terminal-metadata'
import { getTerminalPathLabel } from './terminal-metadata'
import type { TerminalLayoutNode, TerminalPaneNode, TerminalSplitNode } from './terminal-pane-layout'
import { normalizeWeights } from './terminal-pane-layout'
import type { TerminalPanelSession } from './terminal-panel-store'

const MIN_PANE_WIDTH = 180
const MIN_PANE_HEIGHT = 96

interface TerminalPaneViewProps {
  layout: TerminalLayoutNode
  sessionsById: ReadonlyMap<string, TerminalPanelSession>
  cwdBySessionId: Readonly<Record<string, string | null>>
  workspaceCwd: string
  activeSessionId: string | null
  panelVisible: boolean
  canSplit: boolean
  onActivate: (sessionId: string) => void
  onAddTab: () => void
  onSplit: (direction: 'horizontal' | 'vertical') => void
  onClose: (sessionId: string) => void
  onExited: (sessionId: string) => void
  onMetadata: (sessionId: string, metadata: TerminalMetadata) => void
  onResizeSplit: (splitId: string, weights: number[]) => void
}

function PaneAction({ label, onClick, children, disabled = false }: {
  label: string
  onClick: () => void
  children: ReactNode
  disabled?: boolean
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="text-muted-foreground hover:text-foreground active:scale-[0.96] transition-[color,transform]"
    >
      {children}
    </Button>
  )
}

function TerminalPane({
  node,
  sessionsById,
  cwdBySessionId,
  workspaceCwd,
  activeSessionId,
  panelVisible,
  canSplit,
  onActivate,
  onAddTab,
  onSplit,
  onClose,
  onExited,
  onMetadata,
}: Omit<TerminalPaneViewProps, 'layout' | 'onResizeSplit'> & { node: TerminalPaneNode }) {
  const paneActiveSessionId = node.sessionIds.includes(node.activeSessionId)
    ? node.activeSessionId
    : node.sessionIds[0]!
  const isFocusedPane = activeSessionId === paneActiveSessionId

  return (
    <section
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background',
        isFocusedPane && 'ring-1 ring-inset ring-primary/20',
      )}
      onMouseDown={() => {
        if (!isFocusedPane) {
          onActivate(paneActiveSessionId)
        }
      }}
      data-terminal-pane={node.paneId}
      data-active={isFocusedPane ? 'true' : 'false'}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 bg-muted/20 px-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {node.sessionIds.map((sessionId) => {
            const session = sessionsById.get(sessionId)
            if (!session) {
              return null
            }
            const selected = sessionId === paneActiveSessionId
            const pathLabel = getTerminalPathLabel(
              workspaceCwd,
              cwdBySessionId[sessionId] ?? session.cwd,
            )
            return (
              <div
                key={sessionId}
                className={cn(
                  'group flex h-6 min-w-0 max-w-52 shrink-0 items-center rounded-md text-[11px] transition-[background-color,color,opacity] duration-150',
                  selected
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                )}
              >
                <button
                  type="button"
                  className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 text-left"
                  onClick={() => onActivate(sessionId)}
                >
                  <TerminalIcon className="size-3 shrink-0" />
                  <span className="truncate">{session.title}</span>
                  {pathLabel && (
                    <span className="max-w-16 shrink-0 truncate rounded bg-foreground/6 px-1 font-mono text-[9px] text-muted-foreground">
                      {pathLabel}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${session.title}`}
                  title={`Close ${session.title}`}
                  className={cn(
                    'mr-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-[background-color,color,opacity] duration-150 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100',
                    selected ? 'opacity-60' : 'opacity-0 group-hover:opacity-60',
                  )}
                  onClick={(event) => {
                    event.stopPropagation()
                    onClose(sessionId)
                  }}
                >
                  <XIcon className="size-2.5" />
                </button>
              </div>
            )
          })}
          <PaneAction label="New terminal tab" onClick={onAddTab}>
            <PlusIcon className="size-3" />
          </PaneAction>
        </div>
        <div className="flex shrink-0 items-center">
          <PaneAction label="Split terminal right" onClick={() => onSplit('horizontal')} disabled={!canSplit}>
            <SplitRightIcon className="size-3" />
          </PaneAction>
          <PaneAction label="Split terminal down" onClick={() => onSplit('vertical')} disabled={!canSplit}>
            <SplitDownIcon className="size-3" />
          </PaneAction>
        </div>
      </div>

      <div className="relative min-h-0 min-w-0 flex-1 bg-background">
        {node.sessionIds.map((sessionId) => {
          const session = sessionsById.get(sessionId)
          if (!session) {
            return null
          }
          const selected = sessionId === paneActiveSessionId
          return (
            <div
              key={sessionId}
              className={cn(
                'absolute inset-0 min-h-0 min-w-0 transition-opacity duration-150 motion-reduce:transition-none',
                selected ? 'z-[1] opacity-100' : 'pointer-events-none z-0 opacity-0',
              )}
              aria-hidden={!selected}
            >
              <ShellView
                ptyId={session.id}
                cwd={session.cwd}
                visible={panelVisible && selected}
                stopOnUnmount={false}
                onMetadata={metadata => onMetadata(session.id, metadata)}
                onExited={() => onExited(session.id)}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

function TerminalSplit({ node, onResizeSplit, renderNode }: {
  node: TerminalSplitNode
  onResizeSplit: (splitId: string, weights: number[]) => void
  renderNode: (node: TerminalLayoutNode) => ReactNode
}) {
  const weights = normalizeWeights(node.children.length, node.weights)
  const totalWeight = weights.reduce((total, weight) => total + weight, 0)

  function beginResize(handleIndex: number, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    const container = handle.parentElement
    if (!container) {
      return
    }
    const bounds = container.getBoundingClientRect()
    const totalSize = node.direction === 'horizontal' ? bounds.width : bounds.height
    if (totalSize <= 0) {
      return
    }

    const start = node.direction === 'horizontal' ? event.clientX : event.clientY
    const currentWeight = weights[handleIndex] ?? 1
    const nextWeight = weights[handleIndex + 1] ?? 1
    const pairWeight = currentWeight + nextWeight
    const minPixels = node.direction === 'horizontal' ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT
    const minWeight = Math.min(
      Math.max((pairWeight * minPixels) / totalSize, 0.1),
      pairWeight / 2,
    )
    const pointerId = event.pointerId
    let frame = 0
    let pendingWeights: number[] | null = null
    let finished = false

    handle.setPointerCapture(pointerId)

    const flush = () => {
      frame = 0
      if (pendingWeights) {
        onResizeSplit(node.id, pendingWeights)
        pendingWeights = null
      }
    }
    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return
      }
      const current = node.direction === 'horizontal' ? moveEvent.clientX : moveEvent.clientY
      const deltaWeight = ((current - start) / totalSize) * totalWeight
      const resizedCurrent = Math.min(
        Math.max(currentWeight + deltaWeight, minWeight),
        pairWeight - minWeight,
      )
      const next = [...weights]
      next[handleIndex] = resizedCurrent
      next[handleIndex + 1] = pairWeight - resizedCurrent
      pendingWeights = next
      if (frame === 0) {
        frame = requestAnimationFrame(flush)
      }
    }
    const finishResize = () => {
      if (finished) {
        return
      }
      finished = true
      if (frame !== 0) {
        cancelAnimationFrame(frame)
        frame = 0
      }
      if (pendingWeights) {
        onResizeSplit(node.id, pendingWeights)
        pendingWeights = null
      }
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId)
      }
      handle.removeEventListener('pointermove', onPointerMove)
      handle.removeEventListener('pointerup', onPointerUp)
      handle.removeEventListener('pointercancel', finishResize)
      window.removeEventListener('blur', finishResize)
    }
    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === pointerId) {
        finishResize()
      }
    }

    handle.addEventListener('pointermove', onPointerMove)
    handle.addEventListener('pointerup', onPointerUp)
    handle.addEventListener('pointercancel', finishResize)
    window.addEventListener('blur', finishResize, { once: true })
  }

  return (
    <div className={cn(
      'flex h-full min-h-0 min-w-0 overflow-hidden bg-border/60',
      node.direction === 'horizontal' ? 'flex-row' : 'flex-col',
    )}
    >
      {node.children.map((child, index) => (
        <div key={child.type === 'split' ? child.id : child.paneId} className="contents">
          <div
            className="h-full min-h-0 min-w-0 bg-background"
            style={{ flexBasis: 0, flexGrow: weights[index] ?? 1 }}
          >
            {renderNode(child)}
          </div>
          {index < node.children.length - 1 && (
            <div
              role="separator"
              aria-orientation={node.direction === 'horizontal' ? 'vertical' : 'horizontal'}
              className={cn(
                'relative z-10 shrink-0 touch-none select-none bg-border/70 after:absolute after:content-[\'\'] hover:bg-primary/35',
                node.direction === 'horizontal'
                  ? 'w-px cursor-col-resize after:inset-y-0 after:-inset-x-1.5'
                  : 'h-px cursor-row-resize after:inset-x-0 after:-inset-y-1.5',
              )}
              onPointerDown={event => beginResize(index, event)}
              onDoubleClick={() => onResizeSplit(node.id, node.children.map(() => 1))}
            />
          )}
        </div>
      ))}
    </div>
  )
}

export function TerminalPaneView(props: TerminalPaneViewProps) {
  const renderNode = (node: TerminalLayoutNode): ReactNode => {
    if (node.type === 'terminal') {
      return <TerminalPane {...props} node={node} />
    }
    return <TerminalSplit node={node} onResizeSplit={props.onResizeSplit} renderNode={renderNode} />
  }

  return renderNode(props.layout)
}
