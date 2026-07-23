import { describe, expect, it } from 'vitest'

import { createPtyAgentStatusOscProcessor } from './agent-status-osc'

describe('createPtyAgentStatusOscProcessor', () => {
  it('removes OSC status payloads from terminal output', () => {
    const process = createPtyAgentStatusOscProcessor()

    expect(process('before\u001B]9999;{"state":"working","agentType":"codex"}\u0007after')).toEqual({
      cleanData: 'beforeafter',
      statuses: [{ state: 'working', agent: 'codex' }],
    })
  })

  it('keeps parser state across PTY chunks', () => {
    const process = createPtyAgentStatusOscProcessor()

    expect(process('before\u001B]999')).toEqual({ cleanData: 'before', statuses: [] })
    expect(process('9;{"state":"done","prompt":"ok"}\u001B\\after')).toEqual({
      cleanData: 'after',
      statuses: [{ state: 'idle', prompt: 'ok' }],
    })
  })

  it('does not let malformed private payloads affect the terminal', () => {
    const process = createPtyAgentStatusOscProcessor()

    expect(process('a\u001B]9999;not-json\u0007b')).toEqual({ cleanData: 'ab', statuses: [] })
  })
})
