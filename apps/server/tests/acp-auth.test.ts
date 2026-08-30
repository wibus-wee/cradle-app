import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ProviderAuthMethod } from '@cradle/chat-runtime-contracts'
import { acpAgents } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../src/infra'
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

  it('persists the selected method and clears legacy credential references', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-acp-auth-'))
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      createLocalAgent({ id: 'auth-agent', name: 'Auth Agent', cmd: '/bin/echo' })
      db().update(acpAgents).set({ authSecretRefsJson: '{"API_KEY":"legacy-secret"}' }).run()
      setAgentAuthSelection('auth-agent', {
        methodId: 'provider-login',
      }, methods)
      updateLaunchConfig('auth-agent', { args: ['--stdio'] })

      expect(readAgentAuthConfig('auth-agent')).toEqual({
        methodId: 'provider-login',
      })
      expect(getInstalled('auth-agent')).toMatchObject({
        authMethodId: 'provider-login',
        authSecretRefsJson: '{}',
      })
      const audit = getAuditLog('auth-agent')
      expect(audit.map(entry => entry.action)).toContain('auth_selection_update')
      clearAgentAuthSelection('auth-agent')
      expect(readAgentAuthConfig('auth-agent')).toEqual({ methodId: null })
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('rejects unavailable and unsupported methods', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-acp-auth-'))
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      createLocalAgent({ id: 'auth-agent', name: 'Auth Agent', cmd: '/bin/echo' })

      expect(() => setAgentAuthSelection('auth-agent', {
        methodId: 'missing',
      }, methods)).toThrow('not advertised')
      expect(() => setAgentAuthSelection('auth-agent', {
        methodId: 'terminal-login',
      }, methods)).toThrow('Terminal auth is unavailable')
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
