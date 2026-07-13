import {
  CircleDashLine as CircleDashedIcon,
  DotCircleLine as CircleDotIcon,
  GitBranchLine as GitBranchIcon,
  GitCompareLine as FileDiffIcon,
  GitPullRequestLine as WorkIcon,
  HeartbeatLine as ActivityIcon,
  RssLine as RssIcon,
  SelectorHorizontalLine as SlidersHorizontalIcon,
  TreeLine as FolderTreeIcon,
} from '@mingcute/react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, LayoutGroup, m } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSessionsByIdOptions } from '~/api-gen/@tanstack/react-query.gen'
import { getWorkspacesByWorkspaceId } from '~/api-gen/sdk.gen'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import { BrowserAnnotationAdjustmentPanel } from '~/features/browser/browser-annotation-adjustment-panel'
import { RuntimeSessionPanel } from '~/features/chat/runtime/runtime-session-panel'
import { useSessionAwaitSummary } from '~/features/chat/session/use-session-await'
import { ChangesPanel, GitPanel } from '~/features/git'
import { IssueAsidePanel } from '~/features/kanban/issue-aside-panel'
import { useLinkedIssue } from '~/features/kanban/use-kanban'
import { useSessionIsolationState } from '~/features/session/use-session-isolation'
import { AwaitPanel } from '~/features/session-await/await-panel'
import { SessionEnvironmentPanel } from '~/features/session-environment/session-environment-panel'
import { FileTree } from '~/features/workspace/file-tree'
import type { Workspace } from '~/features/workspace/types'
import { getLocalWorkspacePath } from '~/features/workspace/types'
import { cn } from '~/lib/cn'
import { useBrowserPanelStore } from '~/store/browser-panel'
import { useLayoutStore } from '~/store/layout'

interface Tab {
  id: string
  labelKey:
    | 'rightAside.tab.files'
    | 'rightAside.tab.changes'
    | 'rightAside.tab.git'
    | 'rightAside.tab.issue'
    | 'rightAside.tab.await'
    | 'rightAside.tab.runtime'
    | 'rightAside.tab.adjustment'
    | 'rightAside.tab.environment'
  icon: typeof FolderTreeIcon
  requiresSession?: boolean
  requiresWork?: boolean
}

const TABS: Tab[] = [
  { id: 'files', labelKey: 'rightAside.tab.files', icon: FolderTreeIcon },
  { id: 'work', labelKey: 'rightAside.tab.environment', icon: WorkIcon, requiresSession: true },
  { id: 'changes', labelKey: 'rightAside.tab.changes', icon: FileDiffIcon },
  { id: 'git', labelKey: 'rightAside.tab.git', icon: GitBranchIcon },
  { id: 'issue', labelKey: 'rightAside.tab.issue', icon: CircleDotIcon, requiresSession: true },
  { id: 'runtime', labelKey: 'rightAside.tab.runtime', icon: ActivityIcon, requiresSession: true },
  { id: 'await', labelKey: 'rightAside.tab.await', icon: RssIcon, requiresSession: true },
  { id: 'adjustment', labelKey: 'rightAside.tab.adjustment', icon: SlidersHorizontalIcon },
]

const TAB_GAP = 2

const TAB_SPRING = {
  type: 'spring',
  stiffness: 520,
  damping: 36,
  mass: 0.7,
} as const

const TAB_LABEL_TRANSITION = {
  width: {
    type: 'spring',
    stiffness: 520,
    damping: 36,
    mass: 0.7,
  },
  opacity: {
    duration: 0.16,
    ease: 'easeOut',
  },
  x: {
    duration: 0.2,
    ease: [0.22, 1, 0.36, 1],
  },
  filter: {
    duration: 0.16,
    ease: 'easeOut',
  },
} as const

const PANEL_SLIDE_TRANSITION = {
  type: 'spring',
  stiffness: 580,
  damping: 48,
  mass: 0.78,
} as const

const PANEL_SLIDE_VARIANTS = {
  enter: (direction: number) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0.96,
  }),
  center: {
    x: '0%',
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? '-100%' : '100%',
    opacity: 0.96,
  }),
} as const

const PANEL_INSTANT_VARIANTS = {
  enter: {
    x: '0%',
    opacity: 1,
  },
  center: {
    x: '0%',
    opacity: 1,
  },
  exit: {
    x: '0%',
    opacity: 1,
  },
} as const

const PANEL_INSTANT_TRANSITION = { duration: 0 } as const

const TAB_INSTANT_LABEL_TRANSITION = {
  width: PANEL_INSTANT_TRANSITION,
  opacity: PANEL_INSTANT_TRANSITION,
  x: PANEL_INSTANT_TRANSITION,
  filter: PANEL_INSTANT_TRANSITION,
} as const

const TAB_ICON_TRANSITION = {
  type: 'spring',
  duration: 0.3,
  bounce: 0,
} as const

interface RightAsideProps {
  active?: boolean
  ownerId?: string | null
  visible?: boolean
  sessionId?: string | null
  workId?: string | null
  workspaceId?: string | null
  workspaceName?: string | null
  workspacePath?: string | null
}

type ActiveRightAsideProps = Omit<RightAsideProps, 'active'>

interface RightAsidePanelContentProps {
  tabId: string
  workId: string | null
  sessionId: string | null
  gitSessionId: string | null
  workspaceId: string | null
  workspacePath: string | null
  issueEmptyLabel: string
  runtimeKind: RuntimeKind | null
  providerTargetId: string | null
  active: boolean
}

function RightAsidePanelContent({
  tabId,
  workId,
  sessionId,
  gitSessionId,
  workspaceId,
  workspacePath,
  issueEmptyLabel,
  runtimeKind,
  providerTargetId,
  active,
}: RightAsidePanelContentProps) {
  if (tabId === 'work' && sessionId) {
    return <SessionEnvironmentPanel sessionId={sessionId} workspaceId={workspaceId} workId={workId} />
  }
  if (tabId === 'files') {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-panel-files"
      >
        <FileTree
          workspaceId={workspaceId}
          workspacePath={workspacePath}
        />
      </div>
    )
  }

  if (tabId === 'git') {
    return (
      <div className="flex flex-1 flex-col overflow-hidden" data-testid="right-aside-panel-git">
        <GitPanel workspaceId={workspaceId} sessionId={gitSessionId} />
      </div>
    )
  }

  if (tabId === 'changes') {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-panel-changes"
      >
        <ChangesPanel
          workspaceId={workspaceId}
          workspacePath={workspacePath}
          sessionId={gitSessionId}
        />
      </div>
    )
  }

  if (tabId === 'issue' && sessionId) {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-panel-issue"
      >
        <IssueAsidePanel sessionId={sessionId} workspaceId={workspaceId} />
      </div>
    )
  }

  if (tabId === 'issue') {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        data-testid="right-aside-panel-issue-empty"
      >
        <p className="text-[11px] text-muted-foreground">{issueEmptyLabel}</p>
      </div>
    )
  }

  if (tabId === 'await') {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-panel-await"
      >
        <AwaitPanel sessionId={sessionId ?? null} workspaceId={workspaceId} />
      </div>
    )
  }

  if (tabId === 'runtime') {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-panel-runtime"
      >
        <RuntimeSessionPanel
          sessionId={sessionId ?? null}
          runtimeKind={runtimeKind}
          providerTargetId={providerTargetId}
          active={active}
        />
      </div>
    )
  }

  if (tabId === 'adjustment') {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside-panel-adjustment"
      >
        <BrowserAnnotationAdjustmentPanel />
      </div>
    )
  }

  return null
}

function TabIcon({
  icon: Icon,
  linkedIcon: LinkedIcon,
  linked,
}: {
  icon: typeof FolderTreeIcon
  linkedIcon?: typeof FolderTreeIcon
  linked: boolean
}) {
  if (!LinkedIcon) {
    return <Icon className="relative size-3.5 shrink-0" aria-hidden="true" />
  }

  return (
    <span className="relative grid size-3.5 shrink-0 place-items-center" aria-hidden="true">
      <m.span
        initial={false}
        animate={{
          opacity: linked ? 0 : 1,
          scale: linked ? 0.25 : 1,
          filter: linked ? 'blur(4px)' : 'blur(0px)',
        }}
        transition={TAB_ICON_TRANSITION}
        className="absolute inset-0 grid place-items-center"
      >
        <Icon className="size-3.5" />
      </m.span>
      <m.span
        initial={false}
        animate={{
          opacity: linked ? 1 : 0,
          scale: linked ? 1 : 0.25,
          filter: linked ? 'blur(0px)' : 'blur(4px)',
        }}
        transition={TAB_ICON_TRANSITION}
        className="absolute inset-0 grid place-items-center"
      >
        <LinkedIcon className="size-3.5" />
      </m.span>
    </span>
  )
}

export function RightAside({
  active = true,
  ownerId = null,
  visible = active,
  ...props
}: RightAsideProps) {
  if (!active) {
    return (
      <div
        className="flex flex-1 flex-col overflow-hidden"
        data-testid="right-aside"
        data-active="false"
      />
    )
  }

  return <ActiveRightAside ownerId={ownerId} visible={visible} {...props} />
}

function ActiveRightAside({
  ownerId,
  visible = true,
  sessionId = null,
  workId = null,
  workspaceId: explicitWorkspaceId = null,
  workspaceName: explicitWorkspaceName = null,
  workspacePath: explicitWorkspacePath = null,
}: ActiveRightAsideProps) {
  const { t } = useTranslation('chrome')
  const activeTab = useLayoutStore(s => s.asideActiveTab)
  const setActiveTab = useLayoutStore(s => s.setAsideActiveTab)
  const [panelDirection, setPanelDirection] = useState(1)
  const userInitiatedPanelTabRef = useRef<string | null>(null)
  const needsSessionMeta = !!sessionId && (!explicitWorkspaceId || activeTab === 'runtime')

  // Derive workspaceId from session
  const { data: sessionMeta } = useQuery({
    ...getSessionsByIdOptions({ path: { id: sessionId ?? '' } }),
    select: s => ({
      workspaceId: s?.workspaceId as string | null,
      runtimeKind: s?.runtimeKind as RuntimeKind | null,
      providerTargetId: s?.providerTargetId as string | null,
    }),
    enabled: needsSessionMeta,
    staleTime: 60_000,
  })
  const workspaceId = explicitWorkspaceId ?? sessionMeta?.workspaceId ?? null
  const { data: isolationState } = useSessionIsolationState(sessionId)
  const gitSessionId = isolationState?.isIsolated ? sessionId : null

  // Derive workspace details from workspaceId
  const { data: workspace } = useQuery({
    queryKey: ['workspace-detail', workspaceId],
    queryFn: async () => {
      const { data } = await getWorkspacesByWorkspaceId({ path: { workspaceId: workspaceId! } })
      return data as Workspace | undefined
    },
    enabled: !!workspaceId && (!explicitWorkspaceName || !explicitWorkspacePath),
    staleTime: 60_000,
  })
  const workspacePath = explicitWorkspacePath ?? getLocalWorkspacePath(workspace)

  // Badge: pending awaits for Feed tab
  const { data: awaitSummary } = useSessionAwaitSummary(sessionId)
  const hasPendingAwaits = awaitSummary?.awaiting ?? false
  const { data: linkedIssue } = useLinkedIssue(sessionId)
  const hasLinkedIssue = !!linkedIssue?.issueId

  // Badge: active adjustment session
  const adjustmentSession = useBrowserPanelStore(state => state.annotationAdjustmentSession)
  const hasActiveAdjustment = adjustmentSession !== null
  const browserPanelOpen = useBrowserPanelStore(state => ownerId
    ? (state.owners[ownerId]?.open ?? false)
    : state.open)
  const hasActiveBrowserTab = useBrowserPanelStore((state) => {
    const ownerState = ownerId ? state.owners[ownerId] : state.owners[state.activeOwnerId]
    const activePanelTab = ownerState?.tabs.find(tab => tab.id === ownerState.activeTabId)
      ?? ownerState?.tabs[0]
    return activePanelTab?.kind === 'browser'
  })
  const visibleTabs = TABS.filter((tab) => {
    if (tab.requiresSession && !sessionId) {
      return false
    }

    if (tab.requiresWork && !workId) {
      return false
    }

    return tab.id !== 'adjustment' || (browserPanelOpen && hasActiveBrowserTab)
  })
  const resolvedActiveTab = visibleTabs.some(tab => tab.id === activeTab)
    ? activeTab
    : 'files'
  const animatePanelTransition = userInitiatedPanelTabRef.current === resolvedActiveTab
  const tabTransition = animatePanelTransition ? TAB_SPRING : PANEL_INSTANT_TRANSITION
  const tabLabelTransition = animatePanelTransition
    ? TAB_LABEL_TRANSITION
    : TAB_INSTANT_LABEL_TRANSITION

  useEffect(() => {
    if (visible && resolvedActiveTab !== activeTab) {
      setActiveTab(resolvedActiveTab)
    }
  }, [activeTab, resolvedActiveTab, setActiveTab, visible])

  useEffect(() => {
    userInitiatedPanelTabRef.current = null
  }, [resolvedActiveTab])

  const activateTab = (tabId: string) => {
    if (tabId === resolvedActiveTab) {
      return
    }

    const activeIndex = visibleTabs.findIndex(tab => tab.id === resolvedActiveTab)
    const nextIndex = visibleTabs.findIndex(tab => tab.id === tabId)
    if (nextIndex === -1) {
      return
    }

    setPanelDirection(nextIndex >= activeIndex ? 1 : -1)
    userInitiatedPanelTabRef.current = tabId
    setActiveTab(tabId)
  }

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      data-testid="right-aside"
      data-visible={visible ? 'true' : 'false'}
      data-active-tab={resolvedActiveTab}
    >
      {/* ── Tab bar ─────────────────────────────────────── */}
      <div className="flex shrink-0 justify-center border-b border-border px-2 py-1.5">
        <LayoutGroup id="right-aside-tabs">
          <div className="relative flex items-center justify-center" style={{ gap: TAB_GAP }}>
            {visibleTabs.map(({ id, labelKey, icon: Icon }) => {
              const isActive = resolvedActiveTab === id
              const showBadge = (id === 'await' && hasPendingAwaits && !isActive)
                || (id === 'adjustment' && hasActiveAdjustment && !isActive)
              const label = t(labelKey)

              const button = (
                <m.button
                  type="button"
                  layout
                  onClick={() => activateTab(id)}
                  aria-label={label}
                  data-testid={`right-aside-tab-${id}`}
                  data-active={isActive ? 'true' : 'false'}
                  initial={false}
                  transition={tabTransition}
                  className={cn(
                    'relative z-10 grid h-7 place-items-center overflow-hidden rounded-md px-2 text-xs select-none',
                    'transition-[color] duration-150 ease-out',
                    {
                      'text-foreground': isActive,
                      'text-muted-foreground hover:text-foreground': !isActive,
                    },
                  )}
                >
                  {isActive && (
                    <m.span
                      layoutId="right-aside-tab-pill"
                      className="absolute inset-0 rounded-md bg-accent"
                      transition={tabTransition}
                    />
                  )}
                  <span className="relative flex min-w-0 items-center justify-center">
                    <TabIcon
                      icon={Icon}
                      linkedIcon={id === 'issue' ? CircleDashedIcon : undefined}
                      linked={id === 'issue' && hasLinkedIssue}
                    />
                    <m.span
                      aria-hidden={!isActive}
                      initial={false}
                      animate={{
                        width: isActive ? 'auto' : 0,
                      }}
                      transition={{
                        width: tabLabelTransition.width,
                      }}
                      className="block overflow-hidden"
                    >
                      <m.span
                        initial={false}
                        animate={{
                          opacity: isActive ? 1 : 0,
                          x: isActive ? 0 : 6,
                          filter: isActive ? 'blur(0px)' : 'blur(3px)',
                        }}
                        transition={{
                          opacity: tabLabelTransition.opacity,
                          x: tabLabelTransition.x,
                          filter: tabLabelTransition.filter,
                        }}
                        className="ml-1.5 block whitespace-nowrap text-left will-change-transform"
                      >
                        {label}
                      </m.span>
                    </m.span>
                  </span>
                  {showBadge && (
                    <span className="absolute right-2 flex size-1.5">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/60" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                    </span>
                  )}
                </m.button>
              )

              return (
                <Tooltip key={id}>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  {!isActive && (
                    <TooltipContent side="bottom" sideOffset={8}>
                      {label}
                    </TooltipContent>
                  )}
                </Tooltip>
              )
            })}
          </div>
        </LayoutGroup>
      </div>

      {/* ── Tab content ─────────────────────────────────── */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <AnimatePresence initial={false} custom={panelDirection}>
          <m.div
            key={resolvedActiveTab}
            custom={panelDirection}
            variants={animatePanelTransition ? PANEL_SLIDE_VARIANTS : PANEL_INSTANT_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={animatePanelTransition ? PANEL_SLIDE_TRANSITION : PANEL_INSTANT_TRANSITION}
            className="absolute inset-0 flex flex-col overflow-hidden will-change-transform"
          >
            <RightAsidePanelContent
              tabId={resolvedActiveTab}
              workId={workId}
              sessionId={sessionId}
              gitSessionId={gitSessionId}
              workspaceId={workspaceId}
              workspacePath={workspacePath}
              issueEmptyLabel={t('rightAside.issue.empty')}
              runtimeKind={sessionMeta?.runtimeKind ?? null}
              providerTargetId={sessionMeta?.providerTargetId ?? null}
              active={visible}
            />
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
