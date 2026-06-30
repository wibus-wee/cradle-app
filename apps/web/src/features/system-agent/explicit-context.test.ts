import { afterEach, describe, expect, it, vi } from 'vitest'

import { createContextRegistry } from '~/features/context/context-registry'

import {
  addCurrentTextSelectionAttachment,
  addExplicitContextAttachment,
  clearExplicitContextAttachments,
  createExplicitContextProvider,
  listExplicitContextAttachments,
  removeExplicitContextAttachment,
} from './explicit-context'

describe('explicit Jarvis context', () => {
  afterEach(() => {
    clearExplicitContextAttachments()
    vi.restoreAllMocks()
  })

  it('publishes explicit references as high-priority selection context', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1779783600000)
    addExplicitContextAttachment({
      id: 'selection-1',
      owner: 'system-agent',
      title: 'Selected text',
      summary: 'User explicitly attached selected text.',
      content: 'The context engine should preserve attention signals.',
      reference: {
        kind: 'text-selection',
        id: 'selection-1',
        label: 'attention signals',
      },
      priority: 130,
      sensitivity: 'private',
    })

    const registry = createContextRegistry({
      readActiveSurface: () => ({ id: 'chat:session-1', type: 'chat', params: { sessionId: 'session-1' }, search: {} }),
      readNow: () => 1779783600000,
      createEnvelopeId: now => `ctx-${now}`,
    })
    registry.setProvider(createExplicitContextProvider())

    expect(registry.collectEnvelope().items).toEqual([
      expect.objectContaining({
        id: 'explicit:selection-1',
        kind: 'selection',
        owner: 'system-agent',
        title: 'Selected text',
        priority: 130,
        freshness: 'live',
        sensitivity: 'private',
        content: 'The context engine should preserve attention signals.',
        references: [{
          kind: 'text-selection',
          id: 'selection-1',
          label: 'attention signals',
        }],
      }),
    ])
  })

  it('attaches current browser text selection and allows removal', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1779783600000)
    vi.spyOn(document, 'getSelection').mockReturnValue({
      toString: () => 'selected renderer text',
    } as Selection)

    const attachment = addCurrentTextSelectionAttachment()

    expect(attachment).toMatchObject({
      owner: 'system-agent',
      title: 'Selected text',
      content: 'selected renderer text',
      reference: {
        kind: 'text-selection',
        label: 'selected renderer text',
      },
      priority: 130,
    })
    expect(listExplicitContextAttachments()).toHaveLength(1)

    removeExplicitContextAttachment(attachment!.id)

    expect(listExplicitContextAttachments()).toEqual([])
  })
})
