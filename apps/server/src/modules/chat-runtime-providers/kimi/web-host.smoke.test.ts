import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { getApiV1Auth, postApiV1Config, postApiV1Sessions } from './protocol/rest/sdk.gen'
import type { KimiWebHostResource } from './web-host'
import { createKimiWebHostResource } from './web-host'

describe('kimi web host smoke', () => {
  const homes: string[] = []
  const resources: KimiWebHostResource[] = []
  const originalDataDir = process.env.CRADLE_DATA_DIR

  afterEach(async () => {
    await Promise.all(resources.splice(0).map(resource => resource.close()))
    await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
    process.env.CRADLE_DATA_DIR = originalDataDir
  })

  it.runIf(process.env.KIMI_SMOKE_TEST === '1')('starts a Cradle-owned host with a resolved Kimi default model', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'cradle-kimi-smoke-'))
    homes.push(dataDir)
    process.env.CRADLE_DATA_DIR = dataDir
    const resource = await createKimiWebHostResource({
      command: process.env.KIMI_COMMAND || 'kimi',
      providerTargetId: 'smoke-target',
      providerConfig: {
        id: 'cradle-smoke-target',
        type: 'openai',
        baseUrl: 'https://example.test/v1',
        defaultModel: 'smoke-model',
      },
      credential: 'smoke-key',
    })
    resources.push(resource)

    const auth = await resource.http.request(getApiV1Auth({ client: resource.http.client }))
    expect(auth.default_model).toBe('cradle-smoke-target/smoke-model')
    await resource.http.request(postApiV1Config({
      client: resource.http.client,
      body: {
        default_model: 'cradle-smoke-target/smoke-model',
        models: {
          'cradle-smoke-target/smoke-model': {
            provider: 'cradle-smoke-target',
            model: 'smoke-model',
            max_context_size: 1_048_576,
          },
        },
      },
    }))
    const session = await resource.http.request(postApiV1Sessions({
      client: resource.http.client,
      body: { metadata: { cwd: process.cwd() } },
    }))
    expect(session.id).toBeTruthy()
  }, 30_000)
})
