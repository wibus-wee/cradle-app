import type { GetBackgroundActivitiesResponse } from '~/api-gen/types.gen'

type BackgroundActivity = GetBackgroundActivitiesResponse[number]

export interface BackgroundActivityFooterItem {
  identity: string
  priority: BackgroundActivity['priority']
  title: string
  description: string | null
  actionLabel: string | null
  actionUrl: string | null
  expiresAt: number | null
  updatedAt: number
}

const PRIORITY_ORDER: Record<BackgroundActivity['priority'], number> = {
  high: 0,
  normal: 1,
  low: 2,
}

export function backgroundActivityFooterIdentity(
  activity: Pick<BackgroundActivity, 'ownerNamespace' | 'key'>,
  noticeId: string,
): string {
  return `${activity.ownerNamespace}\u0000${activity.key}\u0000${noticeId}`
}

export function selectBackgroundActivityFooterItems(
  activities: readonly BackgroundActivity[] | undefined,
  dismissedIdentities: ReadonlySet<string>,
  now = Date.now(),
): BackgroundActivityFooterItem[] {
  if (!activities) {
    return []
  }

  return activities
    .flatMap((activity): BackgroundActivityFooterItem[] => {
      const footer = activity.presentation.footer
      if (!footer || (footer.expiresAt !== null && footer.expiresAt <= now)) {
        return []
      }
      const identity = backgroundActivityFooterIdentity(activity, footer.id)
      if (dismissedIdentities.has(identity)) {
        return []
      }
      return [{
        identity,
        priority: activity.priority,
        title: footer.title,
        description: footer.description,
        actionLabel: footer.actionLabel,
        actionUrl: footer.actionUrl,
        expiresAt: footer.expiresAt,
        updatedAt: activity.updatedAt,
      }]
    })
    .toSorted((left, right) => {
      const priority = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority]
      if (priority !== 0) {
        return priority
      }
      if (left.updatedAt !== right.updatedAt) {
        return right.updatedAt - left.updatedAt
      }
      return left.identity.localeCompare(right.identity)
    })
}
