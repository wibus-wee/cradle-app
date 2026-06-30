/* Verifies Cradle-owned plugin activation policy persistence. */

import { describe, expect, it } from 'vitest'

import {
  isPluginEnabled,
  listPluginActivationPolicies,
  readPluginActivationPolicy,
  setPluginActivationPolicy,
} from './activation-policy'

describe('plugin activation policy', () => {
  it('defaults plugins to enabled when no user policy exists', () => {
    expect(readPluginActivationPolicy('@cradle/policy-default')).toBeNull()
    expect(isPluginEnabled('@cradle/policy-default')).toBe(true)
  })

  it('persists explicit disabled and enabled policy by plugin identity', () => {
    const disabled = setPluginActivationPolicy('@cradle/policy-toggle', {
      enabled: false,
      reason: 'test disable',
    })

    expect(disabled).toMatchObject({
      pluginName: '@cradle/policy-toggle',
      enabled: false,
      reason: 'test disable',
    })
    expect(isPluginEnabled('@cradle/policy-toggle')).toBe(false)

    const enabled = setPluginActivationPolicy('@cradle/policy-toggle', {
      enabled: true,
      reason: null,
    })

    expect(enabled).toMatchObject({
      pluginName: '@cradle/policy-toggle',
      enabled: true,
      reason: null,
    })
    expect(isPluginEnabled('@cradle/policy-toggle')).toBe(true)
    expect(listPluginActivationPolicies().filter(policy => policy.pluginName === '@cradle/policy-toggle')).toHaveLength(1)
  })
})
