import { describe, expect, it } from 'vitest'

import { resolveM0LaunchPolicy } from './launch-policy.mjs'

describe('m0 launch policy', () => {
  it('adds the runner-only Linux sandbox allowance to development and packaged launches', () => {
    expect(resolveM0LaunchPolicy({
      platform: 'linux',
      githubActions: 'true',
      noSandboxRequest: '1',
    })).toEqual({
      noSandbox: true,
      developmentArgs: ['--noSandbox'],
      packagedArgs: ['--no-sandbox'],
    })
  })

  it('keeps the Electron sandbox enabled by default', () => {
    expect(resolveM0LaunchPolicy({
      platform: 'linux',
      githubActions: 'true',
    })).toEqual({
      noSandbox: false,
      developmentArgs: [],
      packagedArgs: [],
    })
  })

  it('rejects the allowance outside a Linux GitHub Actions runner', () => {
    expect(() => resolveM0LaunchPolicy({
      platform: 'linux',
      githubActions: undefined,
      noSandboxRequest: '1',
    })).toThrow('allowed only on Linux GitHub Actions runners')
    expect(() => resolveM0LaunchPolicy({
      platform: 'win32',
      githubActions: 'true',
      noSandboxRequest: '1',
    })).toThrow('allowed only on Linux GitHub Actions runners')
  })

  it('rejects ambiguous allowance values', () => {
    expect(() => resolveM0LaunchPolicy({
      platform: 'linux',
      githubActions: 'true',
      noSandboxRequest: 'true',
    })).toThrow('must be unset or 1')
  })
})
