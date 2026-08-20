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
  it('partitions runtime controls above product commands', () => {
    const items = partitionSlashCommandPanelItems([
      command({ id: 'runtime:goal', name: 'goal', source: 'runtime', iconKey: 'goal' }),
      command({ id: 'cradle:review', name: 'review', source: 'cradle', iconKey: 'code-review' }),
      command({ id: 'runtime:btw', name: 'btw', source: 'runtime', iconKey: 'quick-question' }),
      command({ id: 'runtime:terminal', name: 'terminal', source: 'runtime', iconKey: 'terminal' }),
      command({ id: 'cradle:side', name: 'side', source: 'cradle', iconKey: 'side-chat' }),
    ])

    expect(items.map(item => item.name)).toEqual(['goal', 'terminal', 'review', 'btw', 'side'])
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
        id: 'runtime',
        label: 'Runtime',
        items: [
          expect.objectContaining({ name: 'goal' }),
        ],
      },
      {
        id: 'commands',
        label: 'Commands',
        items: [
          expect.objectContaining({ name: 'btw' }),
          expect.objectContaining({ name: 'side' }),
          expect.objectContaining({ name: 'commit' }),
        ],
      },
    ])
  })
})

describe('slash command search', () => {
  const commands = [
    command({
      id: 'runtime:terminal',
      name: 'terminal',
      label: 'Terminal',
      source: 'runtime',
      aliases: ['shell'],
      description: 'Show command and process activity.',
      iconKey: 'terminal',
    }),
    command({
      id: 'runtime:compact',
      name: 'compact',
      label: 'Compact',
      source: 'runtime',
      description: 'Compact this conversation context.',
      iconKey: 'compact',
    }),
    command({
      id: 'cradle:commit',
      name: 'commit',
      label: 'Commit',
      source: 'cradle',
      description: 'Propose a clean commit sequence',
      iconKey: 'commit',
    }),
  ]

  it('only returns the exact command for a complete command name', () => {
    expect(getSlashCommandPanelItems(commands, 'commit').map(item => item.name)).toEqual(['commit'])
  })

  it('returns commands that share a command-name prefix', () => {
    expect(getSlashCommandPanelItems(commands, 'com').map(item => item.name)).toEqual(['compact', 'commit'])
  })

  it('matches command aliases by prefix', () => {
    expect(getSlashCommandPanelItems(commands, 'shell').map(item => item.name)).toEqual(['terminal'])
  })

  it('does not search descriptions', () => {
    expect(getSlashCommandPanelItems(commands, 'conversation')).toEqual([])
  })
})
