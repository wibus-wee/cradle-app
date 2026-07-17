import { describe, expect, it } from 'vitest'

import { renderCliProxyConfig } from './sidecar'

describe('cLIProxyAPI sidecar configuration', () => {
  it('binds the data and management planes to a private loopback configuration', () => {
    const config = renderCliProxyConfig({
      port: 8317,
      authDir: '/cradle/plugins/cli-proxy-api/state/auth',
      dataPlaneKey: 'data-secret',
      managementKey: 'management-secret',
    })

    expect(config).toContain('host: "127.0.0.1"')
    expect(config).toContain('port: 8317')
    expect(config).toContain('auth-dir: "/cradle/plugins/cli-proxy-api/state/auth"')
    expect(config).toContain('  - "data-secret"')
    expect(config).toContain('  allow-remote: false')
    expect(config).toContain('  secret-key: "management-secret"')
    expect(config).toContain('  disable-control-panel: true')
  })
})
