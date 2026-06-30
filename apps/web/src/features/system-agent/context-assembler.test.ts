import { describe, expect, it } from 'vitest'

import type { ContextEnvelope, ContextItem } from '~/features/context/context-items'

import { assembleContextForPrompt } from './context-assembler'

const NOW = 1779781200000

function item(input: Partial<ContextItem> & Pick<ContextItem, 'id' | 'kind' | 'owner' | 'title' | 'summary' | 'priority' | 'tokenEstimate'>): ContextItem {
  return {
    freshness: 'live',
    sensitivity: 'private',
    createdAt: NOW,
    ...input,
  }
}

function envelope(items: ContextItem[]): ContextEnvelope {
  return {
    id: 'ctx-1',
    capturedAt: NOW,
    activeSurfaceId: 'chat:session-1',
    activeSurfaceType: 'chat',
    activeSurfaceParams: { sessionId: 'session-1' },
    activeSurfaceSearch: {},
    items,
  }
}

describe('context assembler', () => {
  it('prioritizes explicit context before implicit context and records trace metadata', () => {
    const result = assembleContextForPrompt(envelope([
      item({
        id: 'chat:attention:session-1',
        kind: 'attention',
        owner: 'chat',
        title: 'Chat attention',
        summary: 'User is viewing historical messages.',
        priority: 95,
        tokenEstimate: 10,
      }),
      item({
        id: 'explicit:selection:1',
        kind: 'selection',
        owner: 'system-agent',
        title: 'Selected text',
        summary: 'User explicitly attached selected text.',
        content: 'Important selected content.',
        priority: 80,
        tokenEstimate: 8,
      }),
    ]), { tokenBudget: 100 })

    expect(result.trace.included.map(decision => decision.itemId)).toEqual([
      'explicit:selection:1',
      'chat:attention:session-1',
    ])
    expect(result.trace.dropped).toEqual([])
    expect(result.trace.includedTokenEstimate).toBe(18)
    expect(result.promptBlock).toContain('selection: Selected text')
    expect(result.promptBlock.indexOf('selection: Selected text')).toBeLessThan(
      result.promptBlock.indexOf('attention: Chat attention'),
    )
  })

  it('drops low-priority items when the token budget is exceeded', () => {
    const result = assembleContextForPrompt(envelope([
      item({
        id: 'explicit:selection:1',
        kind: 'selection',
        owner: 'system-agent',
        title: 'Selected text',
        summary: 'User explicitly attached selected text.',
        priority: 130,
        tokenEstimate: 15,
      }),
      item({
        id: 'layout:state',
        kind: 'layout',
        owner: 'system-agent',
        title: 'Layout',
        summary: 'Sidebar collapsed.',
        priority: 10,
        tokenEstimate: 12,
      }),
    ]), { tokenBudget: 20 })

    expect(result.trace.included.map(decision => decision.itemId)).toEqual(['explicit:selection:1'])
    expect(result.trace.dropped).toMatchObject([
      { itemId: 'layout:state', reason: 'budget-exceeded' },
    ])
    expect(result.promptBlock).not.toContain('Sidebar collapsed')
  })

  it('drops secret items regardless of available budget', () => {
    const result = assembleContextForPrompt(envelope([
      item({
        id: 'provider:secret',
        kind: 'entity',
        owner: 'providers',
        title: 'API key',
        summary: 'Provider key is visible.',
        priority: 200,
        tokenEstimate: 4,
        sensitivity: 'secret',
      }),
    ]), { tokenBudget: 100 })

    expect(result.trace.included).toEqual([])
    expect(result.trace.dropped).toMatchObject([
      { itemId: 'provider:secret', reason: 'secret' },
    ])
    expect(result.promptBlock).toBe('<cradle_context>\ncontext: none\n</cradle_context>')
  })
})
