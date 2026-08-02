import { describe, expect, it } from 'vitest'

import type { ChatComposerSlashCommand } from './chat-slash-commands'
import {
  getSlashCommandPanelItems,
  groupSlashCommandPanelItems,
  partitionSlashCommandPanelItems,
} from './slash-command-input'

function command(
  overrides: Pick<ChatComposerSlashCommand, 'id' | 'name' | 'source'> & Partial<ChatComposerSlashCommand>,
): ChatComposerSlashCommand {
  return {
    description: `${overrides.name} command`,
    argumentHint: '',
    action: { kind: 'insertText', text: `/${overrides.name} ` },
    ...overrides,
  }
}

describe('slash command panel grouping', () => {
  it('partitions product commands above runtime controls', () => {
    const items = partitionSlashCommandPanelItems([
      command({ id: 'runtime:goal', name: 'goal', source: 'runtime', iconKey: 'goal' }),
      command({ id: 'cradle:review', name: 'review', source: 'cradle', iconKey: 'code-review' }),
      command({ id: 'runtime:btw', name: 'btw', source: 'runtime', iconKey: 'quick-question' }),
      command({ id: 'runtime:terminal', name: 'terminal', source: 'runtime', iconKey: 'terminal' }),
      command({ id: 'cradle:side', name: 'side', source: 'cradle', iconKey: 'side-chat' }),
    ])

    expect(items.map(item => item.name)).toEqual(['review', 'btw', 'side', 'goal', 'terminal'])
  })

  it('groups side and btw together under Commands by product semantics', () => {
    const sections = groupSlashCommandPanelItems(getSlashCommandPanelItems([
      command({ id: 'runtime:goal', name: 'goal', source: 'runtime', iconKey: 'goal' }),
      command({ id: 'runtime:btw', name: 'btw', source: 'runtime', iconKey: 'quick-question' }),
      command({ id: 'cradle:side', name: 'side', source: 'cradle', iconKey: 'side-chat' }),
      command({ id: 'cradle:commit', name: 'commit', source: 'cradle', iconKey: 'commit' }),
    ], ''))

    expect(sections).toEqual([
      {
        id: 'commands',
        label: 'Commands',
        items: [
          expect.objectContaining({ name: 'btw' }),
          expect.objectContaining({ name: 'side' }),
          expect.objectContaining({ name: 'commit' }),
        ],
      },
      {
        id: 'runtime',
        label: 'Runtime',
        items: [
          expect.objectContaining({ name: 'goal' }),
        ],
      },
    ])
  })
})
