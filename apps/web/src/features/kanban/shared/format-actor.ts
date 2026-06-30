import type { TFunction } from 'i18next'

import type { IssueCommentAuthor } from '~/features/kanban/types'

type KanbanTranslation = TFunction<'kanban'>

export function formatActorName(actor: IssueCommentAuthor, t: KanbanTranslation): string {
  if (actor.kind === 'user' && (actor.id === '__self__' || !actor.id)) {
    return t('issue.activity.actor.you')
  }
  if (actor.kind === 'system') {
    return t('issue.activity.actor.system')
  }
  return actor.displayName
}

export function formatActorLabel(actor: IssueCommentAuthor, t: KanbanTranslation): string | null {
  if (actor.kind === 'provider-target') {
    return t('issue.activity.actor.provider')
  }
  if (actor.kind === 'agent' && actor.label === 'Agent') {
    return t('issue.activity.actor.agent')
  }
  return actor.label
}

export function formatRelativeTime(ts: number | null | undefined, t: KanbanTranslation): string {
  if (!ts) {
    return ''
  }
  const diff = Date.now() - ts * 1000
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) {
    return t('issue.activity.time.justNow')
  }
  if (minutes < 60) {
    return t('issue.activity.time.minutesAgo', { count: minutes })
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return t('issue.activity.time.hoursAgo', { count: hours })
  }
  const days = Math.floor(hours / 24)
  return t('issue.activity.time.daysAgo', { count: days })
}
