import { afterEach, describe, expect, it, vi } from 'vitest'

import { printResult } from './output'

function readPrintedJson(spy: ReturnType<typeof vi.spyOn>): unknown {
  const firstCall = spy.mock.calls[0]
  expect(firstCall).toBeDefined()
  return JSON.parse(String(firstCall?.[0]))
}

describe('printResult', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('selects fields from array records before JSON output', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult(
      [{ id: 'snapshot-1', runId: 'run-1', status: 'complete', events: [{ phase: 'final' }] }],
      {
        forceJson: true,
        format: 'json',
        jsonFields: ['id', 'runId', 'status']
      }
    )

    expect(readPrintedJson(logSpy)).toEqual([
      { id: 'snapshot-1', runId: 'run-1', status: 'complete' }
    ])
  })

  it('selects fields from a wrapped array when it is the best field match', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult(
      {
        sessionId: 'session-1',
        snapshots: [
          {
            id: 'snapshot-1',
            runId: 'run-1',
            status: 'complete',
            events: [{ phase: 'final', payload: { nested: true } }]
          }
        ]
      },
      {
        forceJson: true,
        format: 'json',
        jsonFields: ['id', 'runId', 'status', 'assistantMessageId']
      }
    )

    expect(readPrintedJson(logSpy)).toEqual([
      { id: 'snapshot-1', runId: 'run-1', status: 'complete' }
    ])
  })

  it('keeps direct record fields ahead of wrapped array fields', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult(
      {
        id: 'session-1',
        snapshots: [{ id: 'snapshot-1' }]
      },
      {
        forceJson: true,
        format: 'json',
        jsonFields: ['id']
      }
    )

    expect(readPrintedJson(logSpy)).toEqual({ id: 'session-1' })
  })

  it('returns an empty array for empty single-collection wrappers', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult(
      {
        sessionId: 'session-1',
        snapshots: []
      },
      {
        forceJson: true,
        format: 'json',
        jsonFields: ['id', 'runId']
      }
    )

    expect(readPrintedJson(logSpy)).toEqual([])
  })

  it('prints thread search hits as agent-readable results', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult(
      [
        {
          sessionId: 'session-1',
          workspaceName: 'Cradle',
          sessionTitle: 'Runtime surfaces',
          matchCount: 3,
          snippets: [
            {
              text: '... provider emits <mark>ui slot</mark> state for declared surfaces ...',
              messageRole: 'assistant',
              messageId: 'message-1',
              ranges: [{ start: 19, end: 26 }],
              createdAt: 1
            }
          ]
        }
      ],
      {
        format: 'agent'
      }
    )

    expect(logSpy).toHaveBeenCalledWith(
      [
        'Result 1',
        'kind: thread',
        'id: session-1',
        'title: Runtime surfaces',
        'workspace: Cradle',
        'messageRole: assistant',
        'matches: 3',
        'preview:',
        '... provider emits ui slot state for declared surfaces ...',
        'next:',
        'cradle chat messages session-1'
      ].join('\n')
    )
  })

  it('prints known search hits as agent-readable results in auto format', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult(
      [
        {
          sessionId: 'session-1',
          sessionTitle: 'Runtime surfaces',
          snippets: [
            {
              text: 'provider emits ui slot state',
              messageRole: 'assistant',
              messageId: 'message-1',
              ranges: [],
              createdAt: 1
            }
          ]
        }
      ],
      {
        format: 'auto'
      }
    )

    expect(logSpy).toHaveBeenCalledWith(
      [
        'Result 1',
        'kind: thread',
        'id: session-1',
        'title: Runtime surfaces',
        'messageRole: assistant',
        'preview:',
        'provider emits ui slot state',
        'next:',
        'cradle chat messages session-1'
      ].join('\n')
    )
  })

  it('prints chronicle search hits as agent-readable results', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult(
      [
        {
          type: 'knowledge',
          id: 'card-1',
          title: 'Search decisions',
          workspaceName: 'Cradle',
          cardType: 'decision',
          dimension: 'technical',
          matchCount: 2,
          snippet: {
            text: 'Return snippets around the matched keyword.',
            ranges: [{ start: 7, end: 15 }]
          }
        }
      ],
      {
        format: 'agent'
      }
    )

    expect(logSpy).toHaveBeenCalledWith(
      [
        'Result 1',
        'kind: chronicle-knowledge',
        'id: card-1',
        'title: Search decisions',
        'workspace: Cradle',
        'cardType: decision',
        'dimension: technical',
        'matches: 2',
        'preview:',
        'Return snippets around the matched keyword.',
        'next:',
        'cradle chronicle knowledge-cards get card-1'
      ].join('\n')
    )
  })

  it('prints issue search hits as agent-readable results', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult(
      [
        {
          id: 'issue-1',
          workspaceId: 'workspace-1',
          number: 12,
          title: 'Improve CLI search output',
          description: 'Agent output should include a preview and a next command.',
          priority: 'medium'
        }
      ],
      {
        format: 'agent'
      }
    )

    expect(logSpy).toHaveBeenCalledWith(
      [
        'Result 1',
        'kind: issue',
        'id: issue-1',
        'title: #12 Improve CLI search output',
        'workspaceId: workspace-1',
        'priority: medium',
        'preview:',
        'Agent output should include a preview and a next command.',
        'next:',
        'cradle issue get issue-1'
      ].join('\n')
    )
  })

  it('falls back to pretty JSON for unknown agent result shapes', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult([{ ok: true, nested: { value: 1 } }], {
      format: 'agent'
    })

    expect(readPrintedJson(logSpy)).toEqual([{ ok: true, nested: { value: 1 } }])
  })

  it('does not force-wrap rows containing wide (CJK) characters', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    printResult(
      [
        { id: 'ws-1', name: '这是一个很长的中文工作区名称测试用例', status: 'active' },
        { id: 'ws-2', name: 'ws2', status: 'archived' }
      ],
      { format: 'table' }
    )

    const printedTable = String(logSpy.mock.calls[0]?.[0])
    const lines = printedTable.split('\n')

    // A broken/wrapped row would split "这是一个很长的中文工作区名称测试用例"
    // across two physical lines even though the terminal is wide enough.
    expect(lines.some(line => line.includes('这是一个很长的中文工作区名称测试用例'))).toBe(true)
    expect(lines).toHaveLength(6)
  })
})
