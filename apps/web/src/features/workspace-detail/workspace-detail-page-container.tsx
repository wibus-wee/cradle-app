import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { DraftChatComposer } from '~/features/chat/composer/containers/draft-chat-composer-container'
import type { Workspace } from '~/features/workspace/types'
import { isLocalWorkspace } from '~/features/workspace/types'
import { useSurfaceActive } from '~/navigation/surface-activity-context'

import { useWorkspaceDetailOwner } from './use-workspace-detail-owner'
import { SHOW_WORKSPACE_WORKFLOW_RULES } from './workspace-detail-config'
import { WorkspaceDetailLoadingView } from './workspace-detail-loading-view'
import { WorkspaceDetailPageView } from './workspace-detail-page-view'
import { WorkspacePaneLoadingView } from './workspace-pane-loading-view'

const LazySkillManager = lazy(() => (
  import('~/features/skills/skill-manager')
    .then(module => ({ default: module.SkillManager }))
))
const LazyWorkspaceWorkflowRules = lazy(() => (
  import('./workspace-workflow-rules-container')
    .then(module => ({ default: module.WorkspaceWorkflowRulesContainer }))
))

export interface WorkspaceDetailPageContainerProps {
  workspaceId: string
  workspace: Workspace | null | undefined
}

export function WorkspaceDetailPageContainer({
  workspaceId,
  workspace,
}: WorkspaceDetailPageContainerProps) {
  const { t } = useTranslation('workspace')
  const owner = useWorkspaceDetailOwner(workspaceId, workspace)
  const isActive = useSurfaceActive()

  if (!owner.workspace) {
    return <WorkspaceDetailLoadingView />
  }

  const workflowRulesContent = owner.activeTab === 'workflow-rules'
    ? (
        <Suspense
          fallback={(
            <WorkspacePaneLoadingView
              label={t('detail.loading.workflow')}
              testId="workspace-workflow-loading"
            />
          )}
        >
          <LazyWorkspaceWorkflowRules
            workspaceId={workspaceId}
            selectedAgentId={owner.selectedWorkflowAgentId}
            onSelectedAgentId={owner.setSelectedWorkflowAgentId}
          />
        </Suspense>
      )
    : null
  const skillsContent = owner.activeTab === 'skills'
    ? (
        <Suspense
          fallback={(
            <WorkspacePaneLoadingView
              label={t('detail.loading.skills')}
              testId="workspace-skills-loading"
            />
          )}
        >
          <LazySkillManager
            workspaceId={workspaceId}
            editableScope="workspace"
            pageTestId="workspace-skills-page"
            title={t('detail.skillManager.title')}
            description={t('detail.skillManager.description')}
          />
        </Suspense>
      )
    : null
  const composer = (
    <DraftChatComposer
      workspaceId={workspaceId}
      remoteHostId={
        isLocalWorkspace(owner.workspace)
          ? null
          : owner.workspace.locator.hostId
      }
      active={isActive}
      onSend={owner.handleDraftComposerSend}
      onSendInNewWindow={owner.handleDraftComposerSendInNewWindow}
      testIdPrefix="workspace-detail"
    />
  )

  return (
    <WorkspaceDetailPageView
      workspace={owner.workspace}
      activeTab={owner.activeTab}
      agentsDocument={owner.agents}
      headings={owner.headings}
      showWorkflowRules={SHOW_WORKSPACE_WORKFLOW_RULES}
      workflowRulesContent={workflowRulesContent}
      skillsContent={skillsContent}
      composer={composer}
      onRename={owner.handleRename}
      onTabChange={owner.setActiveTab}
    />
  )
}
