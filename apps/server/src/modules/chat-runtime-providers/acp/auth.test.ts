import { describe, expect, it } from 'vitest'

import { projectAcpAuthMethods } from './auth'

describe('projectAcpAuthMethods', () => {
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
})
