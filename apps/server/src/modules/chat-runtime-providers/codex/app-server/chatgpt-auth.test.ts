import { describe, expect, it } from 'vitest'

import type { CodexConfig } from '../../../provider-contracts/provider-base'
import { readTrustedCodexConfig } from '../../../provider-contracts/provider-base'
import {
  buildCodexAuthEnvironment,
  buildCodexBedrockModelProviderConfig,
  resolveCodexAuthMode,
} from '../config/runtime-config'
import {
  CODEX_BEDROCK_API_KEY_SECRET_KIND,
  CODEX_CHATGPT_AUTH_SECRET_KIND,
  CODEX_PERSONAL_ACCESS_TOKEN_SECRET_KIND,
  resolveCodexAppServerAuth,
} from './chatgpt-auth'

function createSecretMetadata(id: string, kind: string, secret: string) {
  return {
    id,
    kind,
    label: 'Codex credential',
    secret,
  }
}

function createCodexConfig(config: Partial<CodexConfig>): CodexConfig {
  return readTrustedCodexConfig(JSON.stringify(config))
}

describe('resolveCodexAppServerAuth', () => {
  it('resolves personal access token credentials without API-key coercion', () => {
    const auth = resolveCodexAppServerAuth(
      { credentialRef: 'credential-pat' },
      { authMode: 'personalAccessToken' },
      'OPENAI_API_KEY',
      {
        readSecret: () => 'pat-token-1',
        readSecretValueWithMetadata: credentialRef => createSecretMetadata(
          credentialRef,
          CODEX_PERSONAL_ACCESS_TOKEN_SECRET_KIND,
          'pat-token-1',
        ),
      },
    )

    expect(auth).toEqual({ kind: 'personalAccessToken', personalAccessToken: 'pat-token-1' })
    expect(resolveCodexAuthMode(createCodexConfig({ authMode: 'personalAccessToken' }), auth))
      .toBe('personalAccessToken')
    expect(buildCodexAuthEnvironment(auth)).toEqual({ CODEX_ACCESS_TOKEN: 'pat-token-1' })
  })

  it('resolves Bedrock credentials with explicit region', () => {
    const auth = resolveCodexAppServerAuth(
      { credentialRef: 'credential-bedrock' },
      { authMode: 'bedrockApiKey', bedrock: { region: 'us-east-1' } },
      'OPENAI_API_KEY',
      {
        readSecret: () => 'bedrock-token-1',
        readSecretValueWithMetadata: credentialRef => createSecretMetadata(
          credentialRef,
          CODEX_BEDROCK_API_KEY_SECRET_KIND,
          'bedrock-token-1',
        ),
      },
    )

    expect(auth).toEqual({
      kind: 'bedrockApiKey',
      bedrockApiKey: 'bedrock-token-1',
      region: 'us-east-1',
    })
    expect(resolveCodexAuthMode(createCodexConfig({ authMode: 'bedrockApiKey' }), auth)).toBe('bedrockApiKey')
    expect(buildCodexAuthEnvironment(auth)).toEqual({
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock-token-1',
      AWS_REGION: 'us-east-1',
    })
    if (auth.kind !== 'bedrockApiKey') {
      throw new Error('Expected Bedrock auth resolution')
    }
    expect(buildCodexBedrockModelProviderConfig(auth.region)).toEqual({
      model_provider: 'amazon-bedrock',
      model_providers: {
        'amazon-bedrock': {
          aws: {
            region: 'us-east-1',
          },
        },
      },
    })
  })

  it('rejects personal access token mode with the wrong credential kind', () => {
    expect(() => resolveCodexAppServerAuth(
      { credentialRef: 'credential-bedrock' },
      { authMode: 'personalAccessToken', bedrock: { region: 'us-east-1' } },
      'OPENAI_API_KEY',
      {
        readSecret: () => 'bedrock-token-1',
        readSecretValueWithMetadata: credentialRef => createSecretMetadata(
          credentialRef,
          CODEX_BEDROCK_API_KEY_SECRET_KIND,
          'bedrock-token-1',
        ),
      },
    )).toThrow('Codex personal access token auth requires a codex-personal-access-token credential, got codex-bedrock-api-key')
  })

  it('rejects Bedrock mode with the wrong credential kind', () => {
    expect(() => resolveCodexAppServerAuth(
      { credentialRef: 'credential-api-key' },
      { authMode: 'bedrockApiKey', bedrock: { region: 'us-east-1' } },
      'OPENAI_API_KEY',
      {
        readSecret: () => 'sk-test',
        readSecretValueWithMetadata: credentialRef => createSecretMetadata(
          credentialRef,
          'openai-compatible',
          'sk-test',
        ),
      },
    )).toThrow('Codex Bedrock API key auth requires a codex-bedrock-api-key credential, got openai-compatible')
  })

  it('rejects native Codex auth modes without a credential', () => {
    expect(() => resolveCodexAppServerAuth(
      {},
      { authMode: 'personalAccessToken' },
      'OPENAI_API_KEY',
      {
        readSecret: () => '',
      },
    )).toThrow('Codex personal access token auth requires a codex-personal-access-token credential')

    expect(() => resolveCodexAppServerAuth(
      {},
      { authMode: 'bedrockApiKey', bedrock: { region: 'us-east-1' } },
      'OPENAI_API_KEY',
      {
        readSecret: () => '',
      },
    )).toThrow('Codex Bedrock API key auth requires a codex-bedrock-api-key credential')
  })

  it('rejects Bedrock credentials without region config', () => {
    expect(() => resolveCodexAppServerAuth(
      { credentialRef: 'credential-bedrock' },
      { authMode: 'bedrockApiKey' },
      'OPENAI_API_KEY',
      {
        readSecret: () => 'bedrock-token-1',
        readSecretValueWithMetadata: credentialRef => createSecretMetadata(
          credentialRef,
          CODEX_BEDROCK_API_KEY_SECRET_KIND,
          'bedrock-token-1',
        ),
      },
    )).toThrow('Codex Bedrock auth requires bedrock.region in provider config')
  })

  it('keeps ChatGPT auth metadata on the ChatGPT token path', () => {
    const accessToken = [
      Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
      Buffer.from(JSON.stringify({
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'account-1',
          chatgpt_plan_type: 'plus',
        },
      })).toString('base64url'),
      'sig',
    ].join('.')

    const auth = resolveCodexAppServerAuth(
      { credentialRef: 'credential-chatgpt' },
      { authMode: 'chatgptAuthTokens' },
      'OPENAI_API_KEY',
      {
        readSecret: () => '',
        readSecretValueWithMetadata: credentialRef => createSecretMetadata(
          credentialRef,
          CODEX_CHATGPT_AUTH_SECRET_KIND,
          JSON.stringify({
            accessToken,
            refreshToken: 'refresh-token-1',
          }),
        ),
      },
    )

    expect(auth).toEqual({
      kind: 'chatgptAuthTokens',
      chatgptAuth: {
        credentialRef: 'credential-chatgpt',
        accessToken,
        refreshToken: 'refresh-token-1',
        chatgptAccountId: 'account-1',
        chatgptPlanType: 'plus',
      },
    })
  })
})
