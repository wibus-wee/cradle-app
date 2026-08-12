import { describe, expect, it } from 'vitest'

import {
  M0_ELECTRON_VERSION,
  M0_SCHEME_PRIVILEGES,
  M0_SCHEME_REGISTRATION,
  REQUIRED_M0_ASSERTIONS,
  validateM0Result,
} from './result-contract.mjs'
import type { M0Result } from './result-schema'

function memoryTrace(baselineMain: number, baselineRenderer: number, peakMain: number, peakRenderer: number) {
  return {
    baselineKiB: { main: baselineMain, renderer: baselineRenderer },
    peakKiB: { main: peakMain, renderer: peakRenderer },
    samples: [
      { elapsedMs: 0, mainKiB: baselineMain, rendererKiB: baselineRenderer },
      { elapsedMs: 25, mainKiB: peakMain, rendererKiB: peakRenderer },
    ],
  }
}

function passingResult(): M0Result {
  const assertions: M0Result['assertions'] = Object.fromEntries(REQUIRED_M0_ASSERTIONS.map(name => [name, {
    passed: true,
    details: { evidenceRecorded: true },
  }]))
  Object.assign(assertions, {
    'scheme.privileges.exact': { passed: true, details: { enabledPrivileges: 5, disabledPrivileges: 4 } },
    'scheme.defaultSession.handled': { passed: true, details: { defaultSessionHandled: true } },
    'scheme.browserPanelPartition.unhandled': { passed: true, details: { partitionHits: 0 } },
    'response.cancel.invokedOnce': { passed: true, details: { responseCancels: 1 } },
    'response.cancel.reachesUpstream': {
      passed: true,
      details: { requestSignalAborts: 1, upstreamCloses: 1, activeRequests: 0, stableChunks: 3 },
    },
    'binary.64MiB.digestAndLength': { passed: true, details: { bytes: 64 * 1024 * 1024 } },
    'binary.64MiB.mainRssBound': { passed: true, details: { deltaKiB: 5_000, gateApplied: true } },
    'binary.64MiB.rendererRssBound': { passed: true, details: { deltaKiB: 5_000, gateApplied: true } },
    'binary.128MiB.nonLinearMainRss': {
      passed: true,
      details: { bytes: 128 * 1024 * 1024, delta64KiB: 5_000, delta128KiB: 6_000, gateApplied: true },
    },
    'binary.128MiB.nonLinearRendererRss': {
      passed: true,
      details: { delta64KiB: 5_000, delta128KiB: 6_000, gateApplied: true },
    },
    'subresource.dynamicModule.dependenciesStayCustomScheme': {
      passed: true,
      details: { customSchemeModuleHits: 4 },
    },
    'security.noBypassCsp': { passed: true, details: { bypassCSP: false } },
    'cleanup.activeRequestsZero': {
      passed: true,
      details: { proxyActiveRequests: 0, upstreamActiveRequests: 0 },
    },
    'cleanup.agentAndServerClosed': { passed: true, details: { agentClosed: true, serverClosed: true } },
  })

  return {
    schemaVersion: 1,
    passed: true,
    mode: 'development',
    electronVersion: M0_ELECTRON_VERSION,
    platform: 'linux',
    arch: 'x64',
    artifactPath: null,
    schemePrivileges: M0_SCHEME_PRIVILEGES,
    assertions,
    memory: {
      chunkBytes: 262144,
      baselineKiB: { main: 100_000, renderer: 50_000 },
      peak64MiBKiB: { main: 105_000, renderer: 55_000 },
      peak128MiBKiB: { main: 108_000, renderer: 58_000 },
      settledKiB: { main: 101_000, renderer: 51_000 },
      trace64MiB: memoryTrace(100_000, 50_000, 105_000, 55_000),
      trace128MiB: memoryTrace(102_000, 52_000, 108_000, 58_000),
    },
    counters: {
      activeRequests: 0,
      responseCancels: 1,
      upstreamCloses: 1,
      defaultSessionHits: 20,
      partitionHits: 0,
      requestSignalAborts: 1,
      cancelStreamChunks: 3,
      customSchemeModuleHits: 4,
    },
    launch: { noSandbox: false, rendererSandbox: true },
  }
}

describe('m0 result contract', () => {
  it('accepts a complete internally consistent passing result', () => {
    expect(validateM0Result(passingResult(), {
      mode: 'development',
      artifactPath: null,
      platform: 'linux',
      arch: 'x64',
    })).toEqual({ ok: true, errors: [] })
  })

  it('rejects empty evidence objects and assertion details', () => {
    const result = passingResult()
    result.memory = {} as typeof result.memory
    result.counters = {} as typeof result.counters
    result.launch = {} as typeof result.launch
    for (const assertion of Object.values(result.assertions)) { assertion.details = {} }

    const validation = validateM0Result(result)
    expect(validation.ok).toBe(false)
    expect(validation.errors).toContain('memory.chunkBytes is required')
    expect(validation.errors).toContain('counters.responseCancels is required')
    expect(validation.errors).toContain('launch.rendererSandbox is required')
    expect(validation.errors).toContain('assertions.fetch.get.queryAndHeaders.details must not be empty')
  })

  it('rejects missing, extra, version-drifted, and internally contradictory evidence', () => {
    const result = passingResult()
    result.electronVersion = '42.4.2'
    delete result.assertions['response.cancel.reachesUpstream']
    result.assertions.unreviewed = { passed: true, details: { evidenceRecorded: true } }
    result.memory.trace64MiB.peakKiB.main = 105_001
    result.counters.responseCancels = 2

    const validation = validateM0Result(result)
    expect(validation.ok).toBe(false)
    expect(validation.errors).toContain('electronVersion must be 42.4.1')
    expect(validation.errors).toContain('missing assertion: response.cancel.reachesUpstream')
    expect(validation.errors).toContain('assertions.unreviewed is not allowed')
    expect(validation.errors).toContain('memory.trace64MiB.peakKiB must match the raw sample maxima')
    expect(validation.errors).toContain('counters.responseCancels must be 1')
  })

  it('uses one locked descriptor for registration and result evidence', () => {
    expect(M0_SCHEME_REGISTRATION).toEqual({
      scheme: 'cradle-server',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    })
    expect(M0_SCHEME_PRIVILEGES).toEqual({
      ...M0_SCHEME_REGISTRATION.privileges,
      codeCache: false,
      bypassCSP: false,
      allowServiceWorkers: false,
      allowExtensions: false,
    })
  })
})
