import { expectTypeOf, it } from 'vitest'

import type { GetIssuesByIdSessionsResponse } from '~/api-gen/types.gen'

declare const getIssuesByIdSessions: typeof import('~/api-gen/sdk.gen').getIssuesByIdSessions

function _listIssueLinkedSessions() {
  return getIssuesByIdSessions({ path: { id: 'issue-id' }, throwOnError: true }).then(({ data }) => data)
}

type IssueLinkedSessionsData = Awaited<ReturnType<typeof _listIssueLinkedSessions>>

it('preserves linked-session execution discriminants through the SDK result', () => {
  expectTypeOf<IssueLinkedSessionsData>().toEqualTypeOf<GetIssuesByIdSessionsResponse>()
  expectTypeOf<IssueLinkedSessionsData[number]['execution']>().toEqualTypeOf<
    GetIssuesByIdSessionsResponse[number]['execution']
  >()
})
