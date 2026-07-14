import { providerTargets, sessions } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '../../infra'
import { getSessionRunContext } from './runtime-session-context'

afterEach(() => {
  db().delete(sessions).run()
  db().delete(providerTargets).run()
})

describe('getSessionRunContext', () => {
  it('projects Universal provider targets into Codex runtime config', () => {
    db().insert(providerTargets).values({
      id: 'universal-target',
      kind: 'manual',
      providerKind: 'universal',
      displayName: 'Universal Target',
      enabled: true,
      connectionConfigJson: JSON.stringify({
        openaiBaseUrl: 'https://anyrouter.example.test/v1',
        anthropicBaseUrl: 'https://anthropic.example.test/v1',
      }),
      enabledModelsJson: JSON.stringify(['gpt-5.5']),
      customModelsJson: '[]',
    }).run()

    db().insert(sessions).values({
      id: 'codex-session',
      title: 'Codex Session',
      providerTargetId: 'universal-target',
      runtimeKind: 'codex',
      configJson: '{}',
    }).run()

    const context = getSessionRunContext('codex-session')
    expect(context).not.toBeNull()
    expect(context?.profile).not.toBeNull()
    const profile = context!.profile!
    const profileConfig = JSON.parse(profile.configJson) as {
      baseUrl?: string
      openaiBaseUrl?: string
      anthropicBaseUrl?: string
    }

    expect(profile.providerKind).toBe('openai-compatible')
    expect(profileConfig.baseUrl).toBe('https://anyrouter.example.test/v1')
    expect(profileConfig.openaiBaseUrl).toBe('https://anyrouter.example.test/v1')
    expect(profileConfig.anthropicBaseUrl).toBe('https://anthropic.example.test/v1')
  })

  it('rejects legacy OpenCode sessions bound to an ordinary provider target', () => {
    db().insert(providerTargets).values({
      id: 'ordinary-target',
      kind: 'manual',
      providerKind: 'openai-compatible',
      displayName: 'Ordinary Target',
      enabled: true,
      connectionConfigJson: JSON.stringify({ baseUrl: 'https://provider.example.test/v1' }),
      enabledModelsJson: '[]',
      customModelsJson: '[]',
    }).run()
    db().insert(sessions).values({
      id: 'opencode-session',
      title: 'OpenCode Session',
      providerTargetId: 'ordinary-target',
      runtimeKind: 'opencode',
      configJson: '{}',
    }).run()

    expect(() => getSessionRunContext('opencode-session')).toThrow(
      'Runtime only supports runtime-owned provider targets',
    )
  })
})
