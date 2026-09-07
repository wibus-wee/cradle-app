import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { startModelApiSimulator } from '@cradle/model-api-simulator'
import { parse } from 'smol-toml'
import { describe, expect, it } from 'vitest'

import type { RuntimeProviderTargetProfile } from '../../../chat-runtime/runtime-provider-types'
import { providerRuntimeHostManager } from '../../../provider-runtime/host-manager'
import { CodexAppServerClient } from '../app-server/client'
import type { ConfigReadResponse } from '../app-server-protocol/v2/ConfigReadResponse'
import { CodexProvider } from '../provider'

const binary = process.env.CRADLE_CODEX_APP_SERVER_PATH ?? ''
const enabled = process.env.CRADLE_CODEX_APP_SERVER_INTEGRATION === '1' && existsSync(binary)

describe.runIf(enabled)('codex native provider config integration', () => {
  it('reads injected configuration and completes a turn against the local model simulator', async () => {
    const cache = resolve(process.cwd(), '../../node_modules/.cache')
    mkdirSync(cache, { recursive: true })
    const dataDir = mkdtempSync(join(cache, 'cradle-codex-config-'))
    const previous = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    const simulator = await startModelApiSimulator({
      autoRespond: true,
      strictRequestValidation: false,
    })
    const clients: CodexAppServerClient[] = []
    const profile: RuntimeProviderTargetProfile = {
      id: 'native-config-smoke',
      providerTargetId: 'native-config-smoke',
      providerTargetKind: 'manual',
      name: 'Native configuration smoke',
      providerKind: 'openai-compatible',
      enabled: true,
      credentialRef: null,
      customModels: '[]',
      iconSlug: null,
      configJson: JSON.stringify({
        apiKey: 'sk-local-simulator',
        baseUrl: simulator.openaiBaseUrl,
        model: 'gpt-test',
        reasoningEffort: 'minimal',
        approvalPolicy: 'never',
        sandboxMode: 'danger-full-access',
        codex: {
          web_search: 'disabled',
          model_verbosity: 'low',
          features: { multi_agent: false },
          responses_api_metadata: { 'cradle.config-test': 'literal-key' },
        },
      }),
    }
    const provider = new CodexProvider({
      readSecret: () => '',
      resolveSkillPaths: () => [],
      recordObservability: () => {},
      createAppServerClient: (options) => {
        const client = new CodexAppServerClient({
          ...options,
          appServerPath: binary,
          env: { ...options.env, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
        })
        const initialize = client.initialize.bind(client)
        client.initialize = async () => {
          await initialize()
          const result = (await client.request('config/read', {
            includeLayers: true,
          })) as ConfigReadResponse
          expect(result.config.web_search).toBe('disabled')
          expect(result.config.model_verbosity).toBe('low')
          expect(result.config.features).toMatchObject({ multi_agent: false })
          expect(result.config.responses_api_metadata).toEqual({
            'cradle.config-test': 'literal-key',
          })
          expect(result.config.model_providers).toMatchObject({
            'cradle-openai-compatible': { base_url: simulator.openaiBaseUrl },
          })
        }
        clients.push(client)
        return client
      },
    })
    try {
      const runtimeSession = await provider.startChatSession({
        chatSessionId: 'config-smoke-session',
        profile,
        workspacePath: dataDir,
        modelId: 'gpt-test',
      })
      const types: string[] = []
      for await (const chunk of provider.streamTurn({
        runId: 'config-smoke-turn',
        runtimeSession,
        profile,
        workspaceId: 'config-smoke-workspace',
        workspacePath: dataDir,
        modelId: 'gpt-test',
        message: {
          id: 'message',
          role: 'user',
          parts: [{ type: 'text', text: 'Reply with a brief greeting.' }],
        },
      })) {
        types.push(chunk.type)
      }
      const result = (await clients[0]!.request('config/read', {
        includeLayers: true,
      })) as ConfigReadResponse
      expect(result.config.web_search).toBe('disabled')
      expect(result.config.model_verbosity).toBe('low')
      expect(result.config.features).toMatchObject({ multi_agent: false })
      expect(result.config.responses_api_metadata).toEqual({ 'cradle.config-test': 'literal-key' })
      expect(types).toContain('text-delta')
      const configPath = join(dataDir, 'runtimes/codex-app-server/config.toml')
      const persisted = existsSync(configPath) ? parse(readFileSync(configPath, 'utf8')) : {}
      expect(persisted.web_search).toBeUndefined()
      expect(persisted.model_verbosity).toBeUndefined()
      expect(persisted.responses_api_metadata).toBeUndefined()
      expect(persisted).not.toHaveProperty('features.multi_agent', false)
    }
    finally {
      await providerRuntimeHostManager.clear()
      await Promise.allSettled(clients.map(client => client.close()))
      await simulator.close()
      if (previous === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previous
      }
      rmSync(dataDir, { recursive: true, force: true })
    }
  }, 30_000)
})
