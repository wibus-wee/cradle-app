import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProviderAuthMethod } from '@cradle/chat-runtime-contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { shutdownInfra } from '../src/infra'
import {
  clearAgentAuthSelection,
  createLocalAgent,
  getAuditLog,
  getInstalled,
  readAgentAuthConfig,
  setAgentAuthSelection,
  updateLaunchConfig,
} from '../src/modules/acp/service'

const methods: ProviderAuthMethod[] = [{
  id: 'api-key',
  name: 'API key',
  kind: 'env_var',
  status: 'supported',
  fields: [
    { name: 'API_KEY', secret: true, optional: false },
    { name: 'REGION', secret: false, optional: true },
  ],
}, {
  id: 'provider-login',
  name: 'Provider login',
  kind: 'agent',
  status: 'supported',
}, {
  id: 'terminal-login',
  name: 'Terminal login',
  kind: 'terminal',
  status: 'unsupported',
  unavailableReason: 'Terminal auth is unavailable',
}]

describe('aCP auth persistence', () => {
  const previousDataDir = process.env.CRADLE_DATA_DIR

  afterEach(() => {
    shutdownInfra()
    if (previousDataDir === undefined) {
      delete process.env.CRADLE_DATA_DIR
    }
    else {
      process.env.CRADLE_DATA_DIR = previousDataDir
    }
  })

  it('persists only method and credential references and preserves them across launch updates', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-acp-auth-'))
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      createLocalAgent({ id: 'auth-agent', name: 'Auth Agent', cmd: '/bin/echo' })
      setAgentAuthSelection('auth-agent', {
        methodId: 'api-key',
        secretRefs: { API_KEY: 'credential-api-key', REGION: 'credential-region' },
      }, methods, new Set(['credential-api-key', 'credential-region']))
      updateLaunchConfig('auth-agent', { args: ['--stdio'] })

      expect(readAgentAuthConfig('auth-agent')).toEqual({
        methodId: 'api-key',
        secretRefs: { API_KEY: 'credential-api-key', REGION: 'credential-region' },
      })
      expect(getInstalled('auth-agent')).toMatchObject({
        authMethodId: 'api-key',
        authSecretRefsJson: JSON.stringify({ API_KEY: 'credential-api-key', REGION: 'credential-region' }),
      })
      const audit = getAuditLog('auth-agent')
      expect(audit.map(entry => entry.action)).toContain('auth_selection_update')
      expect(JSON.stringify(audit)).not.toContain('credential-api-key')
      expect(JSON.stringify(audit)).not.toContain('credential-region')

      clearAgentAuthSelection('auth-agent')
      expect(readAgentAuthConfig('auth-agent')).toEqual({ methodId: null, secretRefs: {} })
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('rejects missing, unknown, unsupported, and agent-auth secret references', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-acp-auth-'))
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      createLocalAgent({ id: 'auth-agent', name: 'Auth Agent', cmd: '/bin/echo' })

      expect(() => setAgentAuthSelection('auth-agent', {
        methodId: 'api-key',
        secretRefs: { API_KEY: 'actual-secret-value' },
      }, methods, new Set())).toThrow('must reference existing Secrets credentials')
      expect(readAgentAuthConfig('auth-agent')).toEqual({ methodId: null, secretRefs: {} })
      expect(() => setAgentAuthSelection('auth-agent', {
        methodId: 'api-key',
        secretRefs: {},
      }, methods, new Set())).toThrow('Required ACP authentication variables are missing')
      expect(() => setAgentAuthSelection('auth-agent', {
        methodId: 'api-key',
        secretRefs: { API_KEY: 'credential-api-key', UNKNOWN: 'credential-unknown' },
      }, methods, new Set(['credential-api-key', 'credential-unknown']))).toThrow('variables not advertised')
      expect(() => setAgentAuthSelection('auth-agent', {
        methodId: 'provider-login',
        secretRefs: { API_KEY: 'credential-api-key' },
      }, methods, new Set(['credential-api-key']))).toThrow('valid only for ACP env-var authentication')
      expect(() => setAgentAuthSelection('auth-agent', {
        methodId: 'terminal-login',
      }, methods, new Set())).toThrow('Terminal auth is unavailable')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
