import { describe, expect, it } from 'vitest'

import {
  getSmartMentionHref,
  getSmartMentionMarkdownLabel,
  parseSmartMentionHref,
} from './smart-mention-utils'

describe('smart mention utils', () => {
  it('roundtrips structured mention attributes through cradle hrefs', () => {
    const attrs = {
      kind: 'issue' as const,
      id: 'CRA-007',
      label: 'CRA-007',
      title: 'Smart mention support',
      detail: 'In Progress · high',
      workspaceId: 'workspace-1',
    }

    const href = getSmartMentionHref(attrs)

    expect(href).toBe('cradle://mention/issue/CRA-007?label=CRA-007&title=Smart+mention+support&detail=In+Progress+%C2%B7+high&workspaceId=workspace-1')
    expect(parseSmartMentionHref(href)).toEqual(attrs)
  })

  it('keeps exported markdown labels readable', () => {
    expect(getSmartMentionMarkdownLabel({
      kind: 'issue',
      id: 'CRA-007',
      label: 'CRA-007',
      title: 'Smart mention support',
    })).toBe('[CRA-007] Smart mention support')
  })

  it('rejects non-mention hrefs', () => {
    expect(parseSmartMentionHref('https://example.com/CRA-007')).toBeNull()
  })
})
