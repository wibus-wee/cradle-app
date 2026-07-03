import { describe, expect, it } from 'vitest'

import type { ChatRuntimeCapabilities, ChatRuntimeUiSlot } from '../capabilities/chat-capabilities'
import {
  createRuntimeUiSlotCommand,
  projectRuntimeComposerSlashCommands,
  RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID,
  RUNTIME_USAGE_COMMAND_ACTION_ID,
} from './chat-slash-commands'

function slot(overrides: Partial<ChatRuntimeUiSlot> & { id: string, name: string }): ChatRuntimeUiSlot {
  return {
    id: overrides.id,
    name: overrides.name,
    label: overrides.label ?? overrides.name,
    description: overrides.description ?? `${overrides.name} slot`,
    argumentHint: overrides.argumentHint ?? '',
    aliases: overrides.aliases,
    iconKey: overrides.iconKey,
    commandText: overrides.commandText,
    commandAction: overrides.commandAction,
    requiresSession: overrides.requiresSession,
    surfaces: overrides.surfaces ?? ['slashCommand'],
  }
}

function capabilities(slots: ChatRuntimeUiSlot[]): ChatRuntimeCapabilities {
  return {
    runtimeKind: 'test-runtime',
    slashCommands: [],
    uiSlots: slots,
    skills: [],
  }
}

describe('runtime UI slot slash commands', () => {
  it('projects descriptor-owned ui actions without reading runtime-specific slot ids', () => {
    const command = createRuntimeUiSlotCommand(slot({
      id: 'plugin-runtime:review',
      name: 'review',
      iconKey: 'code-review',
      commandAction: {
        kind: 'uiAction',
        actionId: RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID,
      },
    }))

    expect(command).toMatchObject({
      id: 'plugin-runtime:review',
      action: {
        kind: 'uiAction',
        actionId: RUNTIME_CODE_REVIEW_COMMAND_ACTION_ID,
      },
    })
  })

  it('projects descriptor-owned submit actions from command text', () => {
    const command = createRuntimeUiSlotCommand(slot({
      id: 'plugin-runtime:compact',
      name: 'compact',
      commandText: '/compact ',
      commandAction: {
        kind: 'submitText',
        requiresEmptyComposer: true,
      },
    }))

    expect(command.action).toEqual({
      kind: 'submitText',
      text: '/compact',
      requiresEmptyComposer: true,
    })
  })

  it('hides session-only runtime slots from draft composers', () => {
    const sessionOnlySlot = slot({
      id: 'plugin-runtime:usage',
      name: 'usage',
      requiresSession: true,
      commandAction: {
        kind: 'uiAction',
        actionId: RUNTIME_USAGE_COMMAND_ACTION_ID,
      },
    })

    expect(projectRuntimeComposerSlashCommands({
      capabilities: capabilities([sessionOnlySlot]),
      mode: 'draft',
    })).toEqual([])
    expect(projectRuntimeComposerSlashCommands({
      capabilities: capabilities([sessionOnlySlot]),
      mode: 'session',
    })).toHaveLength(1)
  })
})
