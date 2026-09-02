import { describe, expect, it } from 'vitest'

import type { GetBackgroundActivitiesResponse } from '~/api-gen/types.gen'

import {
  backgroundActivityFooterIdentity,
  selectBackgroundActivityFooterItems,
} from './background-activity-footer-state'

type Activity = GetBackgroundActivitiesResponse[number]

function activity(input: {
  ownerNamespace: string
  key: string
  priority: Activity['priority']
  updatedAt: number
  noticeId: string
  expiresAt?: number | null
}): Activity {
  return {
    ownerNamespace: input.ownerNamespace,
    key: input.key,
    title: input.key,
    priority: input.priority,
    trigger: 'test',
    manuallyRunnable: false,
    status: 'succeeded',
    progress: null,
    presentation: {
      footer: {
        id: input.noticeId,
        title: input.noticeId,
        description: null,
        actionLabel: null,
        actionUrl: null,
        expiresAt: input.expiresAt ?? null,
      },
    },
    lastError: null,
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
    startedAt: input.updatedAt,
    finishedAt: input.updatedAt,
  }
}

describe('background activity footer item selection', () => {
  it('orders multiple notices by priority and recency', () => {
    const items = selectBackgroundActivityFooterItems([
      activity({ ownerNamespace: 'low', key: 'new', priority: 'low', updatedAt: 30, noticeId: 'low' }),
      activity({ ownerNamespace: 'high', key: 'old', priority: 'high', updatedAt: 10, noticeId: 'high' }),
      activity({ ownerNamespace: 'normal', key: 'newest', priority: 'normal', updatedAt: 40, noticeId: 'normal' }),
    ], 20)

    expect(items.map(item => item.title)).toEqual(['high', 'normal', 'low'])
  })

  it('keeps active notices and hides only expired notices', () => {
    const active = activity({
      ownerNamespace: 'owner',
      key: 'active',
      priority: 'normal',
      updatedAt: 20,
      noticeId: 'notice-1',
    })
    const expired = activity({
      ownerNamespace: 'owner',
      key: 'expired',
      priority: 'normal',
      updatedAt: 10,
      noticeId: 'notice-2',
      expiresAt: 99,
    })
    expect(selectBackgroundActivityFooterItems([active, expired], 100).map(item => item.identity)).toEqual([
      backgroundActivityFooterIdentity(active, 'notice-1'),
    ])
  })
})
