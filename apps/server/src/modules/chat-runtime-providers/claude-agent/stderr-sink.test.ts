import { describe, expect, it } from 'vitest'

import { createClaudeStderrSink } from './input-projector'

describe('createClaudeStderrSink', () => {
  it('appends captured stderr to an Error message while preserving the original object and stack', () => {
    const sink = createClaudeStderrSink()
    const original = new Error('Claude Code process exited with code 1')
    const originalStack = original.stack
    sink.onStderr('fatal: cannot read config\n')
    sink.onStderr('panic: bootstrap failed')

    const result = sink.enrichError(original)

    // Same object reference so callers keep instanceof checks and the stack.
    expect(result).toBe(original)
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe(
      'Claude Code process exited with code 1\n\n[Claude Code stderr]\nfatal: cannot read config\npanic: bootstrap failed',
    )
    expect((result as Error).stack).toBe(originalStack)
  })

  it('returns the error unchanged when no stderr was captured', () => {
    const sink = createClaudeStderrSink()
    const original = new Error('Claude Code process exited with code 1')

    const result = sink.enrichError(original)

    expect(result).toBe(original)
    expect((result as Error).message).toBe('Claude Code process exited with code 1')
  })

  it('wraps non-Error throws in a new Error carrying the stderr', () => {
    const sink = createClaudeStderrSink()
    sink.onStderr('boom')
    const result = sink.enrichError('something went wrong')

    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('something went wrong\n\n[Claude Code stderr]\nboom')
  })

  it('preserves ProviderRuntimeError identity (instanceof checks still pass) when stderr is present', () => {
    class ProviderRuntimeError extends Error {
      providerError = { _tag: 'auth_failed' as const }
    }
    const sink = createClaudeStderrSink()
    const original = new ProviderRuntimeError('auth failed')
    sink.onStderr('stderr noise')

    const result = sink.enrichError(original)

    expect(result).toBe(original)
    expect(result).toBeInstanceOf(ProviderRuntimeError)
    expect((result as ProviderRuntimeError).providerError._tag).toBe('auth_failed')
  })
})
