import { describe, expect, it } from 'vitest'

import { projectAcpAuthMethods } from './auth'

describe('projectAcpAuthMethods', () => {
  it('applies env-var defaults and omits protocol metadata', () => {
    const methods = projectAcpAuthMethods([{
      id: 'api-key',
      name: 'API key',
      description: 'Use a provider API key',
      type: 'env_var',
      link: 'https://example.test/keys',
      vars: [
        { name: 'API_KEY' },
        { name: 'REGION', secret: false, optional: true, _meta: { internal: 'ignored' } },
      ],
      _meta: { internal: 'ignored' },
    }])

    expect(methods).toEqual([{
      id: 'api-key',
      name: 'API key',
      description: 'Use a provider API key',
      kind: 'env_var',
      status: 'supported',
      link: 'https://example.test/keys',
      fields: [
        { name: 'API_KEY', secret: true, optional: false },
        { name: 'REGION', secret: false, optional: true },
      ],
    }])
    expect(JSON.stringify(methods)).not.toContain('_meta')
  })

  it('keeps agent auth supported and marks terminal auth unsupported without terminal launch data', () => {
    const methods = projectAcpAuthMethods([
      { id: 'login', name: 'Provider login' },
      {
        id: 'terminal-login',
        name: 'Terminal login',
        type: 'terminal',
        args: ['--secret-argument'],
        env: { TOKEN: 'secret-value' },
      },
    ])

    expect(methods[0]).toMatchObject({ id: 'login', kind: 'agent', status: 'supported' })
    expect(methods[1]).toMatchObject({
      id: 'terminal-login',
      kind: 'terminal',
      status: 'unsupported',
    })
    expect(JSON.stringify(methods)).not.toContain('secret')
  })

  it('marks environment authentication unavailable for remote transports', () => {
    expect(projectAcpAuthMethods([{
      id: 'api-key',
      name: 'API key',
      type: 'env_var',
      vars: [{ name: 'API_KEY' }],
    }], { supportsEnvironmentAuth: false })).toEqual([expect.objectContaining({
      id: 'api-key',
      kind: 'env_var',
      status: 'unsupported',
      unavailableReason: 'Environment-variable authentication requires a local ACP process.',
    })])
  })
})
