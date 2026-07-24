import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Workspace } from '~/features/workspace/types'
import { getWorkspaceLocationLabel } from '~/features/workspace/types'

import { WorkspaceDetailDocumentView } from './workspace-detail-document-view'
import { WorkspaceDetailTabsView } from './workspace-detail-tabs-view'
import { WorkspaceDetailTitleView } from './workspace-detail-title-view'
import {
  buildWorkspaceDetailTocLayout,
  EMPTY_WORKSPACE_DETAIL_TOC_LAYOUT,
} from './workspace-detail-toc'
import { WorkspaceDetailTocView } from './workspace-detail-toc-view'
import type {
  WorkspaceDetailDocumentState,
  WorkspaceDetailTab,
  WorkspaceDetailTocHeading,
  WorkspaceDetailTocLayout,
} from './workspace-detail-types'

export interface WorkspaceDetailPageViewProps {
  workspace: Workspace
  activeTab: WorkspaceDetailTab
  agentsDocument: WorkspaceDetailDocumentState
  headings: WorkspaceDetailTocHeading[]
  showWorkflowRules: boolean
  workflowRulesContent: ReactNode
  skillsContent: ReactNode
  composer: ReactNode
  onRename: (name: string) => void | Promise<void>
  onTabChange: (tab: WorkspaceDetailTab) => void
}

export function WorkspaceDetailPageView({
  workspace,
  activeTab,
  agentsDocument,
  headings,
  showWorkflowRules,
  workflowRulesContent,
  skillsContent,
  composer,
  onRename,
  onTabChange,
}: WorkspaceDetailPageViewProps) {
  const { t } = useTranslation('workspace')
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const [tocLayout, setTocLayout] = useState<WorkspaceDetailTocLayout>(
    EMPTY_WORKSPACE_DETAIL_TOC_LAYOUT,
  )

  const handleTocNavigate = useCallback((slug: string) => {
    const element = document.getElementById(slug)
    if (!element) {
      return
    }

    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveSlug(slug)
  }, [])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) {
      return
    }

    let animationFrameId: number | null = null
    const updateTocState = (): void => {
      const nextLayout = buildWorkspaceDetailTocLayout(container, headings)
      setActiveSlug(nextLayout.activeSlug)
      setTocLayout(nextLayout)
    }
    const queueTocStateUpdate = (): void => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = null
        updateTocState()
      })
    }

    const mutationObserver = new MutationObserver(queueTocStateUpdate)
    const resizeObserver = new ResizeObserver(queueTocStateUpdate)
    mutationObserver.observe(container, { childList: true, subtree: true })
    resizeObserver.observe(container)
    if (container.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(container.firstElementChild)
    }
    container.addEventListener('scroll', queueTocStateUpdate, { passive: true })
    queueTocStateUpdate()

    return () => {
      container.removeEventListener('scroll', queueTocStateUpdate)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
    }
  }, [activeTab, headings])

  return (
    <div
      className="@container/workspace-detail flex h-full overflow-hidden bg-background"
      data-testid="workspace-detail-page"
    >
      <div className="relative min-w-0 flex-1">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto [&::-webkit-scrollbar]:hidden"
        >
          <div className="mx-auto max-w-5xl px-5 py-6 sm:px-8">
            <div className="mb-6">
              <WorkspaceDetailTitleView
                value={workspace.name}
                onSave={onRename}
              />
              <p
                data-testid="workspace-detail-path"
                className="mt-1 truncate font-mono text-[12px] text-muted-foreground"
              >
                {getWorkspaceLocationLabel(workspace)}
              </p>
            </div>

            <WorkspaceDetailTabsView
              activeTab={activeTab}
              showWorkflowRules={showWorkflowRules}
              onChange={onTabChange}
            />

            <div className={activeTab === 'overview' ? undefined : 'hidden'}>
              <WorkspaceDetailDocumentView
                id="section-agents"
                filename="AGENTS.md"
                testId="workspace-detail-agents-section"
                document={agentsDocument}
                placeholder={t('detail.agents.placeholder')}
              />

              {agentsDocument.content === null && !agentsDocument.loading
                ? (
                    <div className="py-16 text-center text-sm text-muted-foreground">
                      {t('detail.agents.empty')}
                    </div>
                  )
                : null}
            </div>

            {showWorkflowRules && activeTab === 'workflow-rules'
              ? workflowRulesContent
              : null}
            {activeTab === 'skills' ? skillsContent : null}

            <div className="h-28" />
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-4">
          <div className="pointer-events-auto mx-auto max-w-160">
            {composer}
          </div>
        </div>
      </div>

      <div className="hidden w-58 shrink-0 @6xl/workspace-detail:block">
        {headings.length > 0
          ? (
              <WorkspaceDetailTocView
                headings={headings}
                activeSlug={activeSlug}
                layout={tocLayout}
                onNavigate={handleTocNavigate}
              />
            )
          : null}
      </div>
    </div>
  )
}
