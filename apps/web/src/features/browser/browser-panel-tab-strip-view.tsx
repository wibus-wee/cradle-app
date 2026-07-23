import {
  Chat1Line as SideConversationIcon,
  CloseLine as CloseIcon,
  Dashboard2Line as ContextUsageIcon,
  FileLine as FileIcon,
  GitCompareLine as DiffIcon,
  GitPullRequestLine as PullRequestIcon,
  GlobeLine as BrowserIcon,
  LayoutTopLine as PlanIcon,
  PencilLine as RefineIcon,
  PlusLine as PlusIcon,
  RobotLine as AgentIcon,
  TerminalBoxLine as TerminalIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import type { BrowserPanelTab } from '~/store/browser-panel'

export interface BrowserPanelTabStripViewProps {
  tabs: BrowserPanelTab[]
  activeTabId: string | null
  activeSessionId: string | null
  discardPromptTabId: string | null
  contextUsageAvailable: boolean
  onSelectTab: (tabId: string) => void
  onRequestCloseTab: (tabId: string) => void
  onDiscardPromptChange: (tabId: string | null) => void
  onDiscardTab: (tabId: string) => void
  onNewTab: () => void
  onOpenContextUsage: () => void
}

function getPanelTabTitle(tab: BrowserPanelTab): string {
  if (tab.kind !== 'browser') {
    return tab.title
  }
  if (tab.title && tab.title !== 'about:blank') {
    return tab.title
  }
  return tab.url === 'about:blank' ? 'New tab' : tab.url
}

function renderPanelTabIcon(tab: BrowserPanelTab) {
  const iconClassName = 'size-3 shrink-0 !text-muted-foreground/60'
  if (tab.kind === 'browser') {
    if (tab.isLoading) {
      return (
        <Spinner
          className="size-3 shrink-0 animate-spin !text-primary"
          aria-hidden="true"
        />
      )
    }
    if (tab.faviconUrl) {
      return <img src={tab.faviconUrl} alt="" className="size-3 shrink-0 rounded-sm" />
    }
    return <BrowserIcon className={iconClassName} aria-hidden="true" />
  }
  if (tab.kind === 'workspace-file') {
    return <FileIcon className={iconClassName} aria-hidden="true" />
  }
  if (tab.kind === 'workspace-diff') {
    return <DiffIcon className={iconClassName} aria-hidden="true" />
  }
  if (tab.kind === 'pull-request') {
    return <PullRequestIcon className={iconClassName} aria-hidden="true" />
  }
  if (tab.kind === 'side-conversation') {
    return <SideConversationIcon className={iconClassName} aria-hidden="true" />
  }
  if (tab.kind === 'context-usage-report') {
    return <ContextUsageIcon className={iconClassName} aria-hidden="true" />
  }
  if (tab.kind === 'launcher') {
    return <PlusIcon className={iconClassName} aria-hidden="true" />
  }
  if (tab.kind === 'tui') {
    return <TerminalIcon className={iconClassName} aria-hidden="true" />
  }
  if (tab.kind === 'plan-document') {
    return <PlanIcon className={iconClassName} aria-hidden="true" />
  }
  if (tab.kind === 'plan-refine') {
    return <RefineIcon className={iconClassName} aria-hidden="true" />
  }
  return <AgentIcon className={iconClassName} aria-hidden="true" />
}

export function BrowserPanelTabStripView({
  tabs,
  activeTabId,
  activeSessionId,
  discardPromptTabId,
  contextUsageAvailable,
  onSelectTab,
  onRequestCloseTab,
  onDiscardPromptChange,
  onDiscardTab,
  onNewTab,
  onOpenContextUsage,
}: BrowserPanelTabStripViewProps) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 bg-card px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={cn(
              'group flex h-7 max-w-44 shrink-0 items-center rounded-md text-[11px] transition-colors',
              tab.id === activeTabId
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground',
            )}
          >
            <Button
              type="button"
              variant="ghost"
              className="h-full min-w-0 flex-1 justify-start gap-1.5 rounded-l-md rounded-r-none py-1 pl-2 pr-1 text-left text-[11px] font-normal hover:bg-transparent"
              onClick={() => onSelectTab(tab.id)}
              aria-current={tab.id === activeTabId ? 'page' : undefined}
            >
              {renderPanelTabIcon(tab)}
              <span className="truncate">{getPanelTabTitle(tab)}</span>
              {tab.kind === 'browser'
                && tab.sessionId
                && tab.sessionId !== activeSessionId
                && tab.sessionTitle
                ? (
                    <span
                      className="ml-0.5 shrink-0 rounded-sm bg-foreground/7 px-1 text-[9px] text-muted-foreground"
                      aria-label={`From ${tab.sessionTitle}`}
                    >
                      {tab.sessionTitle}
                    </span>
                  )
                : null}
            </Button>
            <Popover
              open={discardPromptTabId === tab.id}
              onOpenChange={(open) => {
                if (!open && discardPromptTabId === tab.id) {
                  onDiscardPromptChange(null)
                }
              }}
            >
              <PopoverTrigger
                render={(
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="mr-0.5 size-5 shrink-0 rounded-sm text-muted-foreground/60 opacity-0 hover:bg-foreground/8 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => onRequestCloseTab(tab.id)}
                    aria-label={`Close ${getPanelTabTitle(tab)}`}
                    aria-haspopup={tab.kind === 'plan-refine' ? 'dialog' : undefined}
                  >
                    <CloseIcon className="size-3" />
                  </Button>
                )}
              />
              {tab.kind === 'plan-refine'
                ? (
                    <PopoverContent side="bottom" align="end" className="w-64 gap-2 p-3">
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-foreground">Discard changes?</div>
                        <div className="text-[11px] leading-4 text-muted-foreground">
                          This plan has unsaved edits.
                        </div>
                      </div>
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => onDiscardPromptChange(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="xs"
                          onClick={() => onDiscardTab(tab.id)}
                        >
                          Discard
                        </Button>
                      </div>
                    </PopoverContent>
                  )
                : null}
            </Popover>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 shrink-0 rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground disabled:opacity-40"
          onClick={onNewTab}
          aria-label="New panel tab"
          title="New panel tab"
        >
          <PlusIcon className="size-3.5" />
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 shrink-0 rounded-md text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground disabled:opacity-30"
        onClick={onOpenContextUsage}
        disabled={!contextUsageAvailable}
        aria-label="Open context usage report"
        title="Context Usage Report"
      >
        <ContextUsageIcon className="size-3.5" />
      </Button>
    </div>
  )
}
