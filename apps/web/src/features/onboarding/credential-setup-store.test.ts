import { describe, expect, it } from 'vitest'

import {
  isProviderSetupSatisfied,
  resolvePendingFirstRunSetupSteps,
} from './credential-setup-store'

describe('isProviderSetupSatisfied', () => {
  it('requires a usable provider option or an external provider record', () => {
    expect(isProviderSetupSatisfied({
      targetsReady: true,
      providerOptionCount: 0,
      externalProviderRecordCount: 0,
    })).toBe(false)
    expect(isProviderSetupSatisfied({
      targetsReady: true,
      providerOptionCount: 1,
      externalProviderRecordCount: 0,
    })).toBe(true)
    expect(isProviderSetupSatisfied({
      targetsReady: true,
      providerOptionCount: 0,
      externalProviderRecordCount: 1,
    })).toBe(true)
  })

  it('waits for provider targets before satisfying the setup step', () => {
    expect(isProviderSetupSatisfied({
      targetsReady: false,
      providerOptionCount: 1,
      externalProviderRecordCount: 1,
    })).toBe(false)
  })
})

describe('resolvePendingFirstRunSetupSteps', () => {
  it('returns both steps when nothing is completed or satisfied', () => {
    expect(resolvePendingFirstRunSetupSteps({
      completedSteps: {},
      providerSatisfied: false,
      githubSatisfied: false,
    })).toEqual(['provider', 'github'])
  })

  it('omits environmentally satisfied steps without requiring a stored key', () => {
    expect(resolvePendingFirstRunSetupSteps({
      completedSteps: {},
      providerSatisfied: true,
      githubSatisfied: false,
    })).toEqual(['github'])
  })

  it('omits stored completed step keys', () => {
    expect(resolvePendingFirstRunSetupSteps({
      completedSteps: { provider: true },
      providerSatisfied: false,
      githubSatisfied: false,
    })).toEqual(['github'])
  })

  it('returns empty when every step is completed or satisfied', () => {
    expect(resolvePendingFirstRunSetupSteps({
      completedSteps: { github: true },
      providerSatisfied: true,
      githubSatisfied: false,
    })).toEqual([])
  })
})
