import {
  CheckLine as CheckIcon,
  CircleDashLine as CircleDashedIcon,
  ClipboardLine as ClipboardIcon,
  CopyLine as CopyIcon,
  DeleteLine as Trash2Icon,
  ExternalLinkLine as ExternalLinkIcon,
  Flag2Line as FlagIcon,
  Flag3Line as MilestoneIcon,
  RobotLine as BotIcon,
  User2Line as UserIcon,
  UserXLine as UserRoundXIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '~/components/ui/alert-dialog'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '~/components/ui/context-menu'
import { toastManager } from '~/components/ui/toast'
import { useAgents } from '~/features/agent-runtime/use-agents'
import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'
import { useFeatureFlag } from '~/features/settings/use-app-preferences'
import { useWorkspaces } from '~/features/workspace/use-workspace'
import { authorizeDangerousAction } from '~/lib/electron'

import { AssigneeAvatar } from './shared/assignee-avatar'
import { formatIssueId } from './shared/format-issue-id'
import { findDelegatedAgent } from './shared/issue-delegation'
import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import type { IssuePriority } from './use-kanban'
import { useDelegateIssue, useDeleteIssue, useUndelegateIssue, useUpdateIssue } from './use-kanban'
import type { StatusCategory } from './use-view-config'

interface IssueContextMenuProps {
  issue: KanbanIssue
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  onOpen: () => void
  children: ReactNode
}

const CURRENT_USER_ASSIGNEE = {
  id: '__self__',
  name: 'Me',
} as const

const priorityOptions: Array<{ value: IssuePriority, label: string }> = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' },
]

const priorityLabelKeys: Record<IssuePriority, 'priority.none' | 'priority.low' | 'priority.medium' | 'priority.high' | 'priority.urgent'> = {
  none: 'priority.none',
  low: 'priority.low',
  medium: 'priority.medium',
  high: 'priority.high',
  urgent: 'priority.urgent',
}

function statusCategory(status: KanbanStatus): StatusCategory {
  return status.category as StatusCategory
}

function copyText(value: string, successTitle: string, failureTitle: string) {
  void navigator.clipboard.writeText(value).then(
    () => toastManager.add({ type: 'success', title: successTitle }),
    () => toastManager.add({ type: 'error', title: failureTitle }),
  )
}

export function IssueContextMenu({ issue, statuses, milestones, onOpen, children }: IssueContextMenuProps) {
  const { t } = useTranslation('kanban')
  const { t: tIsolation } = useTranslation('session-isolation')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [runInIsolation, setRunInIsolation] = useState(false)
  const { workspaces } = useWorkspaces()
  const { agents } = useAgents()
  const updateIssue = useUpdateIssue()
  const delegateIssue = useDelegateIssue()
  const deleteIssue = useDeleteIssue()
  const undelegateIssue = useUndelegateIssue()
  const issueKey = formatIssueId(issue, workspaces)
  const localAuthForDangerousActions = useFeatureFlag('localAuthForDangerousActions')
  const delegateAgents = agents.filter(agent => !!agent.providerTargetId)
  const delegatedAgent = findDelegatedAgent(issue, delegateAgents)
  const currentUserName = t('assignee.currentUser')
  const assignedHuman = issue.assigneeKind === 'user'
    ? issue.assigneeId === CURRENT_USER_ASSIGNEE.id
      ? { ...CURRENT_USER_ASSIGNEE, name: currentUserName }
      : { id: issue.assigneeId ?? '', name: issue.assigneeId ?? t('assignee.unknownUser') }
    : null
  const assigneeValue = assignedHuman?.id ? `user:${assignedHuman.id}` : ''
  const agentValue = delegatedAgent ? `agent:${delegatedAgent.id}` : ''

  const isMutating = updateIssue.isPending || delegateIssue.isPending || deleteIssue.isPending || undelegateIssue.isPending
  const currentStatusValue = issue.statusId ?? ''
  const currentMilestoneValue = issue.milestoneId ?? ''

  const handleDelete = async () => {
    const authorized = await authorizeDangerousAction({
      action: 'delete',
      resource: 'issue',
      label: issueKey,
      enabled: localAuthForDangerousActions,
    })
    if (!authorized) {
      return
    }
    setDeleteDialogOpen(false)
    deleteIssue.mutate(issue.id)
  }

  const handleAssigneeChange = (value: string) => {
    if (value === '') {
      updateIssue.mutate({ id: issue.id, patch: { assigneeKind: null, assigneeId: null } })
      return
    }

    const [kind, id] = value.split(':', 2) as ['user', string]
    if (kind === 'user') {
      updateIssue.mutate({ id: issue.id, patch: { assigneeKind: 'user', assigneeId: id } })
    }
  }

  const handleAgentChange = (value: string) => {
    if (value === '') {
      if (issue.delegateAgentId || issue.delegateProviderTargetId) {
        undelegateIssue.mutate({ issueId: issue.id })
      }
      return
    }

    const [, id] = value.split(':', 2)
    const agent = delegateAgents.find(candidate => candidate.id === id)
    if (typeof agent?.providerTargetId !== 'string' || !agent.providerTargetId) {
      return
    }
    delegateIssue.mutate({
      issueId: issue.id,
      providerTargetId: agent.providerTargetId,
      agentId: agent.id,
      runInIsolation,
    })
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {children}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-64">
          <ContextMenuLabel className="truncate">
            {issueKey}
          </ContextMenuLabel>
          <ContextMenuItem onSelect={onOpen}>
            <ExternalLinkIcon className="size-4" />
            {t('context.openIssue')}
          </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={() => copyText(issueKey, t('context.copyIssueKeySuccess'), t('context.copyFailed'))}>
          <CopyIcon className="size-4" />
          {t('context.copyIssueKey')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(issue.title, t('context.copyTitleSuccess'), t('context.copyFailed'))}>
          <ClipboardIcon className="size-4" />
          {t('context.copyTitle')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => copyText(issue.id, t('context.copyIssueIdSuccess'), t('context.copyFailed'))}>
          <ClipboardIcon className="size-4" />
          {t('context.copyIssueId')}
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={isMutating || statuses.length === 0}>
            <CircleDashedIcon className="size-4" />
            {t('property.status')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuRadioGroup
              value={currentStatusValue}
              onValueChange={statusId => updateIssue.mutate({ id: issue.id, patch: { statusId: statusId || null } })}
            >
              {statuses.map(status => (
                <ContextMenuRadioItem key={status.id} value={status.id} disabled={isMutating}>
                  <StatusIcon category={statusCategory(status)} size={14} />
                  <span className="truncate">{status.name}</span>
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={isMutating}>
            <FlagIcon className="size-4" />
            {t('property.priority')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            <ContextMenuRadioGroup
              value={issue.priority}
              onValueChange={priority => updateIssue.mutate({ id: issue.id, patch: { priority: priority as IssuePriority } })}
            >
              {priorityOptions.map(priority => (
                <ContextMenuRadioItem key={priority.value} value={priority.value} disabled={isMutating}>
                  <PriorityIcon priority={priority.value} size={14} />
                  {t(priorityLabelKeys[priority.value])}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={isMutating}>
            <MilestoneIcon className="size-4" />
            {t('property.milestone')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuRadioGroup
              value={currentMilestoneValue}
              onValueChange={milestoneId => updateIssue.mutate({ id: issue.id, patch: { milestoneId: milestoneId || null } })}
            >
              <ContextMenuRadioItem value="" disabled={isMutating}>
                <CircleDashedIcon className="size-4" />
                {t('issue.label.noMilestone')}
              </ContextMenuRadioItem>
              {milestones.length > 0 && <ContextMenuSeparator />}
              {milestones.map(milestone => (
                <ContextMenuRadioItem key={milestone.id} value={milestone.id} disabled={isMutating}>
                  <MilestoneIcon className="size-4" />
                  <span className="truncate">{milestone.title}</span>
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={isMutating}>
            {assignedHuman
              ? <UserIcon className="size-4" />
              : <UserRoundXIcon className="size-4" />}
            {t('property.assignee')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuRadioGroup value={assigneeValue} onValueChange={handleAssigneeChange}>
              <ContextMenuRadioItem value="" disabled={isMutating}>
                <UserRoundXIcon className="size-4" />
                {t('assignee.unassigned')}
              </ContextMenuRadioItem>
              <ContextMenuSeparator />
              <ContextMenuLabel>{t('assignee.teamMembers')}</ContextMenuLabel>
              <ContextMenuRadioItem value={`user:${CURRENT_USER_ASSIGNEE.id}`} disabled={isMutating}>
                <AssigneeAvatar name={currentUserName} size={18} />
                <span className="truncate">{currentUserName}</span>
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={isMutating}>
            {delegatedAgent
              ? <BotIcon className="size-4" />
              : <UserRoundXIcon className="size-4" />}
            {t('property.agent')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuCheckboxItem
              checked={runInIsolation}
              onCheckedChange={checked => setRunInIsolation(checked === true)}
              data-testid="issue-context-delegate-isolation"
            >
              {tIsolation('delegate.runInIsolation')}
            </ContextMenuCheckboxItem>
            <ContextMenuSeparator />
            <ContextMenuRadioGroup value={agentValue} onValueChange={handleAgentChange}>
              <ContextMenuRadioItem value="" disabled={isMutating}>
                <UserRoundXIcon className="size-4" />
                {t('agent.none')}
              </ContextMenuRadioItem>
              <ContextMenuSeparator />
              <ContextMenuLabel>{t('agent.availableAgents')}</ContextMenuLabel>
              {delegateAgents.length === 0
                ? (
                    <ContextMenuItem disabled>
                      <BotIcon className="size-4" />
                      {t('agent.noAgentsConfigured')}
                    </ContextMenuItem>
                  )
                : delegateAgents.map(agent => (
                    <ContextMenuRadioItem
                      key={agent.id}
                      value={`agent:${agent.id}`}
                      disabled={isMutating}
                    >
                      <BotIcon className="size-4" />
                      <span className="truncate">{agent.name}</span>
                    </ContextMenuRadioItem>
                  ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem disabled={isMutating} variant="destructive" onSelect={() => setDeleteDialogOpen(true)}>
          <Trash2Icon className="size-4" />
          {t('context.deleteIssue')}
        </ContextMenuItem>
        {isMutating && (
          <ContextMenuItem disabled>
            <CheckIcon className="size-4" />
            {t('context.applyingChanges')}
          </ContextMenuItem>
        )}
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2Icon className="size-5 !text-destructive" />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {t('context.deleteIssue')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span>{t('context.deleteDescriptionPrefix')}</span>
              <span>{issueKey}</span>
              <span>{t('context.deleteDescriptionSuffix')}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('context.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              {t('context.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
