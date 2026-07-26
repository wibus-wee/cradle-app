import { afterEach, describe, expect, it, vi } from 'vitest'

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
  CodexChatgptAuthReauthRequiredError,
  resolveCodexAppServerAuth,
  resolveFreshCodexChatgptAuthCredential,
  setCodexChatgptAuthRefreshFetchForTests,
} from './chatgpt-auth'

afterEach(() => {
  setCodexChatgptAuthRefreshFetchForTests(null)
})

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

describe('resolveFreshCodexChatgptAuthCredential', () => {
  it('single-flights concurrent refreshes and persists refresh-token rotation once', async () => {
    let secret = JSON.stringify({
      accessToken: createJwt({ exp: 0 }),
      refreshToken: 'refresh-token-1',
      chatgptAccountId: 'account-1',
      chatgptPlanType: 'plus',
    })
    const accessToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    const refresh = vi.fn(async () => new Response(JSON.stringify({
      access_token: accessToken,
      refresh_token: 'refresh-token-2',
    }), { status: 200 }))
    const updateSecretValue = vi.fn((_credentialRef: string, value: string) => {
      secret = value
    })
    setCodexChatgptAuthRefreshFetchForTests(refresh)

    const credentialRefs = [
      'credential-chatgpt',
      'credential-chatgpt',
      'credential-chatgpt',
      'credential-chatgpt',
      'credential-chatgpt',
      'credential-chatgpt',
    ]
    const results = await Promise.all(credentialRefs.map(credentialRef => resolveFreshCodexChatgptAuthCredential({
      credentialRef,
      store: { readSecret: () => secret, updateSecretValue },
    })))

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(updateSecretValue).toHaveBeenCalledTimes(1)
    expect(results.map(result => result.accessToken)).toEqual(Array.from({ length: 6 }).fill(accessToken))
    expect(JSON.parse(secret)).toMatchObject({ accessToken, refreshToken: 'refresh-token-2' })
  })

  it('maps invalid refresh credentials to reauth-required without erasing the stored secret', async () => {
    const secret = JSON.stringify({
      accessToken: createJwt({ exp: 0 }),
      refreshToken: 'refresh-token-1',
      chatgptAccountId: 'account-1',
      chatgptPlanType: 'plus',
    })
    const updateSecretValue = vi.fn()
    setCodexChatgptAuthRefreshFetchForTests(async () => new Response(JSON.stringify({
      error: { code: 'invalid_grant' },
    }), { status: 401 }))

    await expect(resolveFreshCodexChatgptAuthCredential({
      credentialRef: 'credential-chatgpt',
      store: { readSecret: () => secret, updateSecretValue },
    })).rejects.toBeInstanceOf(CodexChatgptAuthReauthRequiredError)

    expect(updateSecretValue).not.toHaveBeenCalled()
  })

  it('does not call refresh while the access token remains outside the refresh window', async () => {
    const accessToken = createJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
    const refresh = vi.fn()
    setCodexChatgptAuthRefreshFetchForTests(refresh)

    const credential = await resolveFreshCodexChatgptAuthCredential({
      credentialRef: 'credential-chatgpt',
      store: {
        readSecret: () => JSON.stringify({
          accessToken,
          refreshToken: 'refresh-token-1',
          chatgptAccountId: 'account-1',
          chatgptPlanType: 'plus',
        }),
        updateSecretValue: vi.fn(),
      },
    })

    expect(credential.accessToken).toBe(accessToken)
    expect(refresh).not.toHaveBeenCalled()
  })
})

function createJwt(input: { exp: number }): string {
  return [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify({
      'exp': input.exp,
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'account-1',
        chatgpt_plan_type: 'plus',
      },
    })).toString('base64url'),
    'sig',
  ].join('.')
}
