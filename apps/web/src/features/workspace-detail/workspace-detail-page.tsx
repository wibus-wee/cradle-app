import {
  FileLine as FileTextIcon,
  PencilLine as PencilIcon,
  ScrollableListLine as ScrollTextIcon,
} from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FileUIPart } from 'ai'
import { m } from 'motion/react'
import type { CSSProperties } from 'react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  getWorkflowRulesByWorkspaceIdOptions,
  getWorkspacesByWorkspaceIdOptions,
  patchWorkspacesByWorkspaceIdMutation,
  postSessionsMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import { MarkdownEditor } from '~/components/editor/markdown-editor'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { runtimeComposerUsesCollapsedInput } from '~/features/agent-runtime/use-runtime-catalog'
import { describeChatExecutionError } from '~/features/chat/commands/chat-execution-errors'
import type { DraftChatComposerSubmitOptions } from '~/features/chat/composer/draft-chat-composer'
import { DraftChatComposer } from '~/features/chat/composer/draft-chat-composer'
import type { ChatContextPart } from '~/features/chat/context/chat-context-parts'
import { readRunRuntimeSettingsPatch } from '~/features/chat/runtime/runtime-settings-presenter'
import { startOptimisticChatResponse } from '~/features/chat/session/optimistic-chat-turn'
import { getWorkspaceLocationLabel, isLocalWorkspace } from '~/features/workspace/types'
import { sessionsQueryKey, updateSessionInSessionLists } from '~/features/workspace/use-session'
import { WORKSPACES_QUERY_KEY } from '~/features/workspace/use-workspace'
import { cn } from '~/lib/cn'
import { openChatSession } from '~/navigation/navigation-commands'
import { useSurfaceActive } from '~/navigation/surface-activity-context'
import { openTearoffChatSessionWindow } from '~/navigation/tearoff-surfaces'

import { useWorkspaceFile } from './use-workspace-file'

const LazySkillManager = lazy(() => import('~/features/skills/skill-manager').then(module => ({ default: module.SkillManager })))
const LazyWorkspaceWorkflowRules = lazy(() => import('./workspace-workflow-rules').then(module => ({ default: module.WorkspaceWorkflowRules })))
const SHOW_WORKFLOW_RULES_TAB = import.meta.env.DEV

/* ─── Types ──────────────────────────────────────────────── */

interface WorkspaceDetailPageProps {
  workspaceId: string
}

interface TocHeading {
  level: number
  text: string
  slug: string
  file: string
}

interface TocHeadingLayout extends TocHeading {
  top: number
  height: number
  visible: boolean
  intensity: number
}

interface TocLayout {
  height: number
  activeSlug: string | null
  items: TocHeadingLayout[]
}

/* ─── Helpers ────────────────────────────────────────────── */

const HEADING_RE = /^(#{1,6})\s+(\S.*)$/gm
const RE_NON_WORD = /[^\w\u4E00-\u9FFF]+/g
const RE_BOUNDARY_DASH = /(^-|-$)/g
const RE_FENCED_CODE = /```[\s\S]*?```/g
const ACTIVE_HEADING_TOP_OFFSET = 80
const HEADING_SELECTOR = 'h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'
const TOC_ITEM_HEIGHT = 22
const EMPTY_TOC_LAYOUT: TocLayout = { height: 0, activeSlug: null, items: [] }
const TOC_PROXIMITY_FADE_RATIO = 0.72

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(RE_NON_WORD, '-')
    .replace(RE_BOUNDARY_DASH, '')
}

function parseHeadings(markdown: string | null, file: string): TocHeading[] {
  if (!markdown) {
    return []
  }
  const result: TocHeading[] = []

  // Strip fenced code blocks before parsing headings
  const stripped = markdown.replace(RE_FENCED_CODE, '')

  HEADING_RE.lastIndex = 0
  let match: RegExpExecArray | null = HEADING_RE.exec(stripped)
  while (match !== null) {
    result.push({
      level: match[1]!.length,
      text: match[2]!.trim(),
      slug: slugify(match[2]!.trim()),
      file,
    })
    match = HEADING_RE.exec(stripped)
  }
  return result
}

function collectVisibleHeadings(container: HTMLElement): HTMLElement[] {
  return Array
    .from(container.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
    .filter(el => el.offsetParent !== null)
}

function buildTocLayout(container: HTMLElement, headings: TocHeading[]): TocLayout {
  const headingEls = collectVisibleHeadings(container)
  if (headingEls.length === 0 || headings.length === 0) {
    return EMPTY_TOC_LAYOUT
  }

  const visibleCount = Math.min(headingEls.length, headings.length)
  const trackHeight = visibleCount * TOC_ITEM_HEIGHT
  const containerTop = container.getBoundingClientRect().top
  const activeScrollTop = container.scrollTop + ACTIVE_HEADING_TOP_OFFSET
  const fadeDistance = Math.max(container.clientHeight * TOC_PROXIMITY_FADE_RATIO, 1)
  let activeSlug = headingEls[0]?.id ?? null

  const items = headingEls.slice(0, visibleCount).map((el, index) => {
    const heading = headings[index]!
    const headingTop = el.getBoundingClientRect().top - containerTop + container.scrollTop
    const headingBottom = headingTop + el.offsetHeight
    const visible = headingBottom >= container.scrollTop && headingTop <= container.scrollTop + container.clientHeight
    const intensity = 1 - Math.min(1, Math.abs(headingTop - activeScrollTop) / fadeDistance)
    if (headingTop <= activeScrollTop) {
      activeSlug = el.id
    }

    return {
      ...heading,
      top: index * TOC_ITEM_HEIGHT,
      height: TOC_ITEM_HEIGHT,
      visible,
      intensity,
    }
  })

  return {
    height: trackHeight,
    activeSlug,
    items,
  }
}

/* ─── Inline editable title ──────────────────────────────── */

function InlineEditTitleEditor({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string
  onCommit: (name: string) => void | Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation('workspace')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const commit = async () => {
    const trimmed = inputRef.current?.value.trim() ?? ''
    if (trimmed && trimmed !== initialValue) {
      try {
        await onCommit(trimmed)
      }
      catch {
        // Rename mutation failed; close editor anyway to avoid stuck state.
      }
    }
    onCancel()
  }

  return (
    <input
      ref={inputRef}
      data-testid="workspace-detail-title-input"
      defaultValue={initialValue}
      aria-label={t('detail.title.aria')}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit()
        }
        if (e.key === 'Escape') {
          onCancel()
        }
      }}
      className="w-full max-w-80 border-b border-foreground/20 bg-transparent py-px text-lg font-semibold text-foreground outline-none focus:border-foreground/50"
    />
  )
}

function InlineEditTitle({
  value,
  onSave,
}: {
  value: string
  onSave: (name: string) => void | Promise<void>
}) {
  const [editing, setEditing] = useState(false)

  return (
    editing
      ? (
          <InlineEditTitleEditor
            key={value}
            initialValue={value}
            onCommit={onSave}
            onCancel={() => setEditing(false)}
          />
        )
      : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            data-testid="workspace-detail-title-trigger"
            className="group inline-flex items-center gap-2 text-left"
          >
            <span className="text-lg font-semibold text-foreground">{value}</span>
            <PencilIcon className="size-3 !text-muted-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )
  )
}

/* ─── Document section ───────────────────────────────────── */

function DocumentSection({
  id,
  filename,
  testId,
  file,
  placeholder,
}: {
  id: string
  filename: string
  testId?: string
  file: { content: string | null, loading: boolean, saving: boolean, save: (md: string) => Promise<unknown> }
  placeholder: string
}) {
  const { t } = useTranslation('workspace')
  const saveDraft = (nextDraft: string) => {
    return file.save(nextDraft).then(() => undefined)
  }

  if (file.loading) {
    return (
      <div id={id} className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner className="size-3.5" />
        {t('document.status.loading')}
      </div>
    )
  }

  if (file.content === null) {
    return null
  }

  return (
    <section id={id} data-testid={testId}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[12px] font-mono text-muted-foreground">{filename}</span>
        {file.saving && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Spinner className="size-2.5" />
            {t('document.status.saving')}
          </span>
        )}
      </div>
      <MarkdownEditor
        content={file.content}
        documentId={id}
        onSave={saveDraft}
        placeholder={placeholder}
      />
    </section>
  )
}

/* ─── Floating TOC with folding path line ────────────────── */

function FloatingToc({
  headings,
  activeSlug,
  layout,
  onNavigate,
}: {
  headings: TocHeading[]
  activeSlug: string | null
  layout: TocLayout
  onNavigate: (slug: string) => void
}) {
  if (headings.length === 0) {
    return null
  }

  const layoutItems = layout.items.length > 0
    ? layout.items
    : headings.map((heading, index) => ({
      ...heading,
      top: index * TOC_ITEM_HEIGHT,
      height: TOC_ITEM_HEIGHT,
      visible: false,
      intensity: 0,
    }))
  const trackHeight = layout.height > 0
    ? layout.height
    : layoutItems.length * TOC_ITEM_HEIGHT

  const minLevel = Math.min(...headings.map(h => h.level))
  const xPerLevel = 10
  const trunkBase = 7
  const tocLabel = layoutItems[0]?.file ?? headings[0]?.file ?? 'Outline'
  const currentActiveSlug = layout.activeSlug ?? activeSlug
  const points: string[] = []
  for (let i = 0; i < layoutItems.length; i++) {
    const x = trunkBase + (layoutItems[i]!.level - minLevel) * xPerLevel
    const y = layoutItems[i]!.top + layoutItems[i]!.height / 2

    if (i === 0) {
      points.push(`M ${x} ${y}`)
    }
    else {
      const prevX = trunkBase + (layoutItems[i - 1]!.level - minLevel) * xPerLevel
      points.push(`L ${prevX} ${y}`)
      if (prevX !== x) {
        points.push(`L ${x} ${y}`)
      }
    }
  }
  const pathD = points.join(' ')

  return (
    <nav className="sticky top-6 w-58 shrink-0 pt-6 pr-4 select-none">
      <span className="block text-[10px] font-mono text-muted-foreground font-medium mb-1.5 px-2">
        {tocLabel}
      </span>
      <div className="relative" style={{ height: trackHeight }}>
        <svg
          className="absolute inset-0 pointer-events-none"
          width="100%"
          height={trackHeight}
          aria-hidden="true"
        >
          <path
            d={pathD}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            className="text-border/50"
          />
        </svg>

        {layoutItems.map((h) => {
          const indent = (h.level - minLevel) * xPerLevel
          const x = trunkBase + indent
          const isActive = currentActiveSlug === h.slug
          const isVisible = h.visible && !isActive
          const proximityOpacity = 0.42 + h.intensity * 0.42
          const tocItemStyle = {
            'top': h.top,
            'height': h.height,
            'paddingLeft': x + 10,
            '--toc-item-opacity': isActive ? 1 : proximityOpacity,
            '--toc-dot-opacity': isActive ? 1 : Math.max(proximityOpacity, isVisible ? 0.78 : 0.5),
          } as CSSProperties

          return (
            <button
              key={`${h.file}-${h.slug}`}
              type="button"
              onClick={() => onNavigate(h.slug)}
              className={cn(
                'group/toc-item absolute flex items-center w-full text-left transition-[color,opacity,text-shadow]',
                'opacity-[var(--toc-item-opacity)] hover:opacity-100 focus-visible:opacity-100',
                'focus-visible:outline-none',
                isActive
                  ? 'text-foreground'
                  : isVisible
                    ? 'text-foreground/70 hover:text-foreground focus-visible:text-foreground'
                  : 'text-muted-foreground hover:text-foreground focus-visible:text-foreground',
              )}
              style={tocItemStyle}
            >
              <span
                className={cn(
                  'absolute size-1.5 rounded-full border transition-[background-color,border-color,box-shadow,opacity]',
                  'opacity-[var(--toc-dot-opacity)] group-hover/toc-item:opacity-100 group-focus-visible/toc-item:opacity-100',
                  isActive
                    ? 'bg-foreground border-foreground shadow-[0_0_10px_color-mix(in_oklab,currentColor_60%,transparent)]'
                    : isVisible
                      ? 'bg-foreground/35 border-foreground/35 group-hover/toc-item:bg-foreground/75 group-hover/toc-item:border-foreground/75 group-hover/toc-item:shadow-[0_0_10px_color-mix(in_oklab,currentColor_45%,transparent)] group-focus-visible/toc-item:bg-foreground/75 group-focus-visible/toc-item:border-foreground/75 group-focus-visible/toc-item:shadow-[0_0_10px_color-mix(in_oklab,currentColor_45%,transparent)]'
                    : 'bg-background border-muted-foreground/30 group-hover/toc-item:bg-foreground/70 group-hover/toc-item:border-foreground/70 group-hover/toc-item:shadow-[0_0_10px_color-mix(in_oklab,currentColor_40%,transparent)] group-focus-visible/toc-item:bg-foreground/70 group-focus-visible/toc-item:border-foreground/70 group-focus-visible/toc-item:shadow-[0_0_10px_color-mix(in_oklab,currentColor_40%,transparent)]',
                )}
                style={{
                  left: x - 3,
                }}
              />
              <span className="truncate text-[11px] transition-[text-shadow] group-hover/toc-item:[text-shadow:0_0_12px_color-mix(in_oklab,currentColor_45%,transparent)] group-focus-visible/toc-item:[text-shadow:0_0_12px_color-mix(in_oklab,currentColor_45%,transparent)]">{h.text}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function useWorkspaceDetailOwner(workspaceId: string) {
  const { t } = useTranslation('workspace')
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'overview' | 'workflow-rules' | 'skills'>('overview')
  const [selectedWorkflowAgentId, setSelectedWorkflowAgentId] = useState<string | null>(null)
  const [tocLayout, setTocLayout] = useState<TocLayout>(EMPTY_TOC_LAYOUT)

  const { data: workspace } = useQuery({
    ...getWorkspacesByWorkspaceIdOptions({ path: { workspaceId } }),
    enabled: !!workspaceId,
  })
  const agents = useWorkspaceFile(workspaceId, 'AGENTS.md')
  const { data: workflowRule } = useQuery({
    ...getWorkflowRulesByWorkspaceIdOptions({
      path: { workspaceId },
      query: selectedWorkflowAgentId ? { agentId: selectedWorkflowAgentId } : {},
    }),
    enabled: SHOW_WORKFLOW_RULES_TAB && activeTab === 'workflow-rules' && !!workspaceId,
  })
  const workflowContent = selectedWorkflowAgentId
    ? (workflowRule?.agentSpecific ?? null)
    : (workflowRule?.global ?? null)

  const headings = (() => {
    if (activeTab === 'overview') {
      return parseHeadings(agents.content, 'AGENTS.md')
    }
    if (SHOW_WORKFLOW_RULES_TAB && activeTab === 'workflow-rules') {
      return parseHeadings(workflowContent, t('detail.toc.workflowRules'))
    }
    return []
  })()

  const renameWorkspaceMutation = useMutation({
    ...patchWorkspacesByWorkspaceIdMutation(),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY }),
      ])
    },
  })

  const createSessionMutation = useMutation({
    ...postSessionsMutation(),
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
      ])
    },
  })

  const handleRename = async (newName: string) => {
    await renameWorkspaceMutation.mutateAsync({ path: { workspaceId }, body: { name: newName } })
  }

  const openCreatedWorkspaceSession = async (sessionId: string, target: 'tab' | 'window') => {
    if (target === 'window') {
      const openedWindow = await openTearoffChatSessionWindow(sessionId)
      if (openedWindow) {
        return
      }
    }
    openChatSession(sessionId)
  }

  const handleDraftComposerSendToTarget = async (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
    opts: DraftChatComposerSubmitOptions,
    target: 'tab' | 'window',
  ) => {
    if (!workspace) {
      return false
    }
    const isRemoteWorkspace = !isLocalWorkspace(workspace)
    if (runtimeComposerUsesCollapsedInput(opts.runtimeComposer)) {
      if (!isRemoteWorkspace && !opts.agentId) {
        return false
      }
      const sessionTitle = text.slice(0, 80) || opts.agentName || opts.agentId || 'Untitled'
      const session = await createSessionMutation.mutateAsync({
        body: isRemoteWorkspace
          ? {
              workspaceId,
              title: sessionTitle,
              runtimeKind: opts.runtimeKind,
              runtimeSettings: opts.runtimeSettings,
            }
          : {
              workspaceId,
              agentId: opts.agentId,
              title: sessionTitle,
              runtimeSettings: opts.runtimeSettings,
            },
      })
      if (!session?.id) {
        return false
      }
      updateSessionInSessionLists(queryClient, {
        id: session.id,
        title: sessionTitle,
        workspaceId,
        agentId: isRemoteWorkspace ? null : opts.agentId,
        runtimeKind: opts.runtimeKind,
      }, { promote: true })
      await openCreatedWorkspaceSession(session.id, target)
      return true
    }
    if (!isRemoteWorkspace && !opts.providerTargetId) {
      return false
    }
    const sessionTitle = text.slice(0, 80)
      || opts.providerTargetName
      || opts.providerTargetId
      || 'Untitled'
    const session = await createSessionMutation.mutateAsync({
      body: isRemoteWorkspace
        ? {
            workspaceId,
            runtimeKind: opts.runtimeKind,
            title: sessionTitle,
            runtimeSettings: opts.runtimeSettings,
          }
        : {
            workspaceId,
            providerTargetId: opts.providerTargetId,
            modelId: opts.modelId ?? null,
            runtimeKind: opts.runtimeKind,
            title: sessionTitle,
            runtimeSettings: opts.runtimeSettings,
          },
    })
    if (!session?.id) {
      return false
    }
    updateSessionInSessionLists(queryClient, {
      id: session.id,
      title: sessionTitle,
      workspaceId,
      providerTargetId: isRemoteWorkspace ? null : (opts.providerTargetId ?? null),
      modelId: isRemoteWorkspace ? null : (opts.modelId ?? null),
      runtimeKind: opts.runtimeKind,
    }, { promote: true })
    await openCreatedWorkspaceSession(session.id, target)

    startOptimisticChatResponse({
      sessionId: session.id,
      queryClient,
      body: {
        text,
        files,
        contextParts,
        modelId: isRemoteWorkspace ? undefined : opts.modelId,
        thinkingEffort: opts.thinkingEffort,
        runtimeSettings: readRunRuntimeSettingsPatch(opts.runtimeSettings),
      },
      onAccepted: () => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
        ])
      },
      onError: (error) => {
        toastManager.add({
          type: 'error',
          title: t('detail.toast.startChatFailed'),
          description: describeChatExecutionError(error)
            ?? (error instanceof Error ? error.message : String(error)),
        })
      },
      onSettled: () => {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
          queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
        ])
      },
    })
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: sessionsQueryKey() }),
    ])
    return true
  }

  const handleDraftComposerSend = (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
    opts: DraftChatComposerSubmitOptions,
  ) => {
    return handleDraftComposerSendToTarget(text, files, contextParts, opts, 'tab')
  }

  const handleDraftComposerSendInNewWindow = (
    text: string,
    files: FileUIPart[],
    contextParts: ChatContextPart[],
    opts: DraftChatComposerSubmitOptions,
  ) => {
    return handleDraftComposerSendToTarget(text, files, contextParts, opts, 'window')
  }

  const handleTocNavigate = (slug: string) => {
    const el = document.getElementById(slug)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveSlug(slug)
    }
  }

  useEffect(() => {
    const container = scrollRef.current
    if (!container) {
      return
    }

    let animationFrameId: number | null = null

    const updateTocState = () => {
      const nextLayout = buildTocLayout(container, headings)
      setActiveSlug(nextLayout.activeSlug)
      setTocLayout(nextLayout)
    }

    const queueTocStateUpdate = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = null
        updateTocState()
      })
    }

    const handleScroll = () => {
      queueTocStateUpdate()
    }

    const mutationObserver = new MutationObserver(queueTocStateUpdate)
    const resizeObserver = new ResizeObserver(queueTocStateUpdate)

    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
    })
    resizeObserver.observe(container)
    if (container.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(container.firstElementChild)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    queueTocStateUpdate()

    return () => {
      container.removeEventListener('scroll', handleScroll)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
    }
  }, [activeTab, headings])

  return {
    activeSlug,
    activeTab,
    agents,
    handleDraftComposerSend,
    handleDraftComposerSendInNewWindow,
    handleRename,
    handleTocNavigate,
    headings,
    scrollRef,
    selectedWorkflowAgentId,
    setActiveTab,
    setSelectedWorkflowAgentId,
    tocLayout,
    workspace,
    workspaceId,
  }
}

function WorkspaceDetailMainColumn({ active, owner }: { active: boolean, owner: ReturnType<typeof useWorkspaceDetailOwner> }) {
  const { t } = useTranslation('workspace')
  const { activeTab, agents, handleDraftComposerSend, handleDraftComposerSendInNewWindow, handleRename, scrollRef, selectedWorkflowAgentId, setActiveTab, setSelectedWorkflowAgentId, workspace, workspaceId } = owner

  if (!workspace) {
    return null
  }
  const workspaceLocationLabel = getWorkspaceLocationLabel(workspace)

  return (
    <div className="relative min-w-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto [&::-webkit-scrollbar]:hidden">
        <m.div className="mx-auto max-w-5xl px-8 py-6">
          <div className="mb-6">
            <InlineEditTitle value={workspace.name} onSave={handleRename} />
            <p data-testid="workspace-detail-path" className="mt-1 truncate font-mono text-[12px] text-muted-foreground">
              {workspaceLocationLabel}
            </p>
          </div>

          <div className="mb-6 flex items-center gap-0.5 overflow-x-auto scrollbar-none">
            {([
              { id: 'overview', label: t('detail.tab.overview'), icon: FileTextIcon },
              ...(SHOW_WORKFLOW_RULES_TAB
                ? [{ id: 'workflow-rules', label: t('detail.tab.workflow'), icon: ScrollTextIcon } as const]
                : []),
              { id: 'skills', label: t('detail.tab.skills'), icon: PencilIcon },
            ] as const).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                data-testid={`workspace-detail-tab-${id}`}
                className={cn(
                  'relative z-10 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors select-none',
                  activeTab === id
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {activeTab === id && (
                  <m.span
                    layoutId="workspace-detail-tab-pill"
                    className="absolute inset-0 rounded-md bg-accent"
                    transition={{ type: 'spring', stiffness: 600, damping: 40 }}
                    style={{ zIndex: -1 }}
                  />
                )}
                <Icon className="relative size-3.5 shrink-0" />
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>

          <div className={activeTab === 'overview' ? undefined : 'hidden'}>
            <DocumentSection
              id="section-agents"
              filename="AGENTS.md"
              testId="workspace-detail-agents-section"
              file={agents}
              placeholder={t('detail.agents.placeholder')}
            />

            {agents.content === null && !agents.loading && (
              <div className="py-16 text-center text-sm text-muted-foreground">
                {t('detail.agents.empty')}
              </div>
            )}
          </div>

          {SHOW_WORKFLOW_RULES_TAB && activeTab === 'workflow-rules' && (
            <Suspense fallback={<WorkspacePaneLoading label={t('detail.loading.workflow')} testId="workspace-workflow-loading" />}>
              <LazyWorkspaceWorkflowRules
                workspaceId={workspaceId}
                selectedAgentId={selectedWorkflowAgentId}
                onSelectedAgentId={setSelectedWorkflowAgentId}
              />
            </Suspense>
          )}

          {activeTab === 'skills' && (
            <Suspense fallback={<WorkspacePaneLoading label={t('detail.loading.skills')} testId="workspace-skills-loading" />}>
              <LazySkillManager
                workspaceId={workspaceId}
                editableScope="workspace"
                pageTestId="workspace-skills-page"
                title={t('detail.skillManager.title')}
                description={t('detail.skillManager.description')}
              />
            </Suspense>
          )}

          <div className="h-28" />
        </m.div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4">
        <div className="pointer-events-auto mx-auto max-w-160">
          <DraftChatComposer
            workspaceId={workspaceId}
            remoteHostId={workspace && !isLocalWorkspace(workspace) ? workspace.locator.hostId : null}
            active={active}
            onSend={handleDraftComposerSend}
            onSendInNewWindow={handleDraftComposerSendInNewWindow}
            testIdPrefix="workspace-detail"
          />
        </div>
      </div>
    </div>
  )
}

function WorkspacePaneLoading({ label, testId }: { label: string, testId: string }) {
  return (
    <output
      data-testid={testId}
      className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
    >
      <span className="inline-flex items-center gap-2 rounded-md bg-foreground/4 px-3 py-2">
        <Spinner className="size-3.5" />
        <span>{label}</span>
      </span>
    </output>
  )
}

/* ─── Main ───────────────────────────────────────────────── */

export function WorkspaceDetailPage({ workspaceId }: WorkspaceDetailPageProps) {
  const owner = useWorkspaceDetailOwner(workspaceId)
  const isActive = useSurfaceActive()

  if (!owner.workspace) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-4 !text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="@container/workspace-detail flex h-full overflow-hidden bg-background" data-testid="workspace-detail-page">
      <WorkspaceDetailMainColumn active={isActive} owner={owner} />

      <div className="hidden w-58 shrink-0 @6xl/workspace-detail:block">
        {owner.headings.length > 0 && (
          <FloatingToc
            headings={owner.headings}
            activeSlug={owner.activeSlug}
            layout={owner.tocLayout}
            onNavigate={owner.handleTocNavigate}
          />
        )}
      </div>
    </div>
  )
}
