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

describe('acp auth persistence', () => {
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

  it('persists and clears the selected supported method', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-acp-auth-'))
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      createLocalAgent({ id: 'auth-agent', name: 'Auth Agent', cmd: '/bin/echo' })
      setAgentAuthSelection('auth-agent', {
        methodId: 'provider-login',
      }, methods)
      updateLaunchConfig('auth-agent', { args: ['--stdio'] })

      expect(readAgentAuthConfig('auth-agent')).toEqual({
        methodId: 'provider-login',
      })
      expect(getInstalled('auth-agent')).toMatchObject({
        authMethodId: 'provider-login',
      })
      expect(getAuditLog('auth-agent').map(entry => entry.action)).toContain('auth_selection_update')

      clearAgentAuthSelection('auth-agent')

      expect(readAgentAuthConfig('auth-agent')).toEqual({ methodId: null })
      expect(getInstalled('auth-agent')).toMatchObject({ authMethodId: null })
      expect(getAuditLog('auth-agent').map(entry => entry.action)).toContain('auth_selection_clear')
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
