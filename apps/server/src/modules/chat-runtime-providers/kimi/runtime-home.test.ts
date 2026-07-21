import { describe, expect, it } from 'vitest'

import { resolveKimiProviderHome, resolveKimiRuntimeHome } from './runtime-home'

describe('kimi runtime home', () => {
  it('uses the Cradle data runtime namespace', () => {
    expect(resolveKimiRuntimeHome({ env: { CRADLE_DATA_DIR: '/tmp/cradle-data' } }))
      .toBe('/tmp/cradle-data/runtimes/kimi')
  })

  it('allocates an isolated home under the provider target namespace', () => {
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = '/tmp/cradle-data'
    try {
      expect(resolveKimiProviderHome('provider/a')).toBe('/tmp/cradle-data/runtimes/kimi/providers/provider%2Fa')
    }
    finally {
      if (previousDataDir === undefined) { delete process.env.CRADLE_DATA_DIR }
      else { process.env.CRADLE_DATA_DIR = previousDataDir }
    }
  })
})
