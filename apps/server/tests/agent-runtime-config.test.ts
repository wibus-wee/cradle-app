import { describe, expect, it } from 'vitest'

import {
  SessionRuntimeConfigJsonSchema,
  writeCodexCliSessionBindingToSessionConfig,
  writeProviderSessionBindingToSessionConfig,
} from '../src/helpers/agent-runtime-config'

const CODEX_SESSION_ID = '019e3c07-d7df-73d2-a3dc-dfaf5f883050'

describe('agent runtime config helpers', () => {
  it('stores a captured Codex CLI session without dropping the cli-tui launch config', () => {
    const initial = JSON.stringify({
      cliTuiLaunch: {
        preset: 'codex',
        executable: 'codex',
        args: ['--model', 'gpt-5.1-codex'],
      },
      unrelated: { value: true },
    })

    const next = writeCodexCliSessionBindingToSessionConfig({
      configJson: initial,
      binding: {
        sessionId: CODEX_SESSION_ID,
        capturedAt: 1_779_123_000,
        startedAt: 1_779_122_900,
        workspacePath: '/tmp/workspace',
        sourcePath: '/tmp/codex/sessions/rollout.jsonl',
      },
    })

    const config = SessionRuntimeConfigJsonSchema.parse(next)

    expect(config.cliTuiLaunch).toEqual({
      preset: 'codex',
      executable: 'codex',
      args: ['--model', 'gpt-5.1-codex'],
    })
    expect(config.providerSession).toEqual({
      source: 'cradle:codex',
      agent: 'codex',
      kind: 'id',
      value: CODEX_SESSION_ID,
      workspacePath: '/tmp/workspace',
      capturedAt: 1_779_123_000,
      startedAt: 1_779_122_900,
      sourcePath: '/tmp/codex/sessions/rollout.jsonl',
      confidence: 'exact',
    })
    expect(config.codexCliSession).toEqual({
      sessionId: CODEX_SESSION_ID,
      capturedAt: 1_779_123_000,
      startedAt: 1_779_122_900,
      workspacePath: '/tmp/workspace',
      sourcePath: '/tmp/codex/sessions/rollout.jsonl',
    })
    expect(JSON.parse(next).unrelated).toEqual({ value: true })
  })

  it('writes generalized providerSession bindings and keeps Codex legacy fields in sync', () => {
    const next = writeProviderSessionBindingToSessionConfig({
      configJson: JSON.stringify({ cliTuiLaunch: { executable: 'codex', args: [] } }),
      binding: {
        source: 'cradle:codex',
        agent: 'codex',
        kind: 'id',
        value: CODEX_SESSION_ID,
        workspacePath: '/tmp/workspace',
        capturedAt: 10,
        startedAt: 9,
        sourcePath: '/tmp/rollout.jsonl',
        confidence: 'exact',
      },
    })

    const config = SessionRuntimeConfigJsonSchema.parse(next)
    expect(config.providerSession?.value).toBe(CODEX_SESSION_ID)
    expect(config.codexCliSession?.sessionId).toBe(CODEX_SESSION_ID)
  })
})
