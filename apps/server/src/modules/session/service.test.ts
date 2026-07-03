import { backendSessionBindings, sessions } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { db } from '../../infra'
import { toOpenCodeRuntimeNativeProviderTargetId } from '../chat-runtime-providers/opencode/native-provider-target-id'
import { get } from './service'

afterEach(() => {
  db().delete(backendSessionBindings).run()
  db().delete(sessions).run()
})

describe('session service provider target projection', () => {
  it('keeps OpenCode native provider targets out of the session providerTargetId field', () => {
    db().insert(sessions).values({
      id: 'opencode-native-session',
      title: 'OpenCode Native Session',
      runtimeKind: 'opencode',
      providerTargetId: null,
      configJson: JSON.stringify({
        requestedModelId: 'openai/gpt-5',
      }),
    }).run()
    db().insert(backendSessionBindings).values({
      id: 'binding-1',
      chatSessionId: 'opencode-native-session',
      providerTargetId: null,
      runtimeKind: 'opencode',
      backendSessionId: 'ses_open_code',
      requestedModelId: 'openai/gpt-5',
    }).run()

    const session = get('opencode-native-session')

    expect(session?.providerTargetId).toBeNull()
    expect(session?.providerTargetId).not.toBe(toOpenCodeRuntimeNativeProviderTargetId('openai'))
    expect(session?.modelId).toBe('openai/gpt-5')
  })
})
