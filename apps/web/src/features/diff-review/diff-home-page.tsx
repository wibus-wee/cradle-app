import { FolderOpen2Line as FolderOpenIcon } from '@mingcute/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffWorkerProvider } from '~/components/common/diff/diff-runtime'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'
import { useWorkspaces } from '~/features/workspace/use-workspace'

import { DiffsIndexContainer } from './review/diffs-index-container'
import { WorkspaceDiffsView } from './workspace-diffs-view'

export interface DiffHomePageProps {
  workspace?: string
  repo?: string
  path?: string
  review?: string
  line?: number
  side?: 'base' | 'head'
  github?: string
}

/**
 * Diffs home.
 *
 * Browsing is repository-first via `DiffsIndexContainer`. Opening a review (or
 * a working-tree / GitHub deep link) drops the index chrome and mounts the
 * review reading surface full-bleed — the detail View already owns Back.
 */
export function DiffHomePage({
  workspace,
  repo,
  path,
  review,
  line,
  side,
  github,
}: DiffHomePageProps) {
  const { t } = useTranslation('diff-review')
  const { t: tWorkspace } = useTranslation('workspace')
  const { workspaces } = useWorkspaces()

  const isDetail = Boolean(review || path || github)

  const selectedWorkspace = useMemo(() => {
    if (workspace) {
      const match = workspaces.find(item => item.id === workspace)
      if (match) {
        return match
      }
    }
    return workspaces[0] ?? null
  }, [workspace, workspaces])

  useRegisterLayoutSlots('diff', useMemo(() => ({
    asideWorkspaceId: selectedWorkspace?.id ?? null,
    hasAside: Boolean(selectedWorkspace) && isDetail,
    hasBrowserPanel: false,
    hasPanel: false,
  }), [isDetail, selectedWorkspace]))

  if (isDetail) {
    if (!selectedWorkspace) {
      return (
        <div className="flex h-full items-center justify-center px-6 bg-background" data-testid="diff-home-page">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpenIcon className="size-5" aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{t('home.empty.title')}</EmptyTitle>
              <EmptyDescription>{tWorkspace('sidebar.projects.empty.description')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      )
    }

    return (
      <div className="h-full min-w-0 overflow-hidden bg-background" data-testid="diff-home-page">
        <WorkspaceDiffsView
          key={selectedWorkspace.id}
          workspaceId={selectedWorkspace.id}
          repo={repo}
          path={path}
          review={review}
          line={line}
          side={side}
          github={github}
        />
      </div>
    )
  }

  return (
    <div className="h-full min-w-0 overflow-hidden bg-background" data-testid="diff-home-page">
      <DiffWorkerProvider>
        <DiffsIndexContainer
          preferredWorkspaceId={workspace}
          selectedRepositoryKey={repo}
        />
      </DiffWorkerProvider>
    </div>
  )
}
