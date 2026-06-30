import { describe, expect, it } from 'vitest'

import {
  SessionRuntimeConfigJsonSchema,
  writeCodexCliSessionBindingToSessionConfig,
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
    expect(config.codexCliSession).toEqual({
      sessionId: CODEX_SESSION_ID,
      capturedAt: 1_779_123_000,
      startedAt: 1_779_122_900,
      workspacePath: '/tmp/workspace',
      sourcePath: '/tmp/codex/sessions/rollout.jsonl',
    })
    expect(JSON.parse(next).unrelated).toEqual({ value: true })
  })
})
