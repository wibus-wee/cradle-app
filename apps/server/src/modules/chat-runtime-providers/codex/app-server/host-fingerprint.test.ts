import { describe, expect, it } from 'vitest'

import { createCodexAppServerHostFingerprint } from './host-fingerprint'

describe('createCodexAppServerHostFingerprint', () => {
  it('excludes request-level config and host-scope-owned Cradle env from fingerprint', () => {
    const fp1 = createCodexAppServerHostFingerprint({
      options: {
        apiKey: 'sk-test',
        config: {
          approval_policy: 'always',
          sandbox_mode: 'read-only',
          model: 'gpt-4',
          mcp_servers: {},
          instructions_paths: ['/tmp/skill.md'],
        },
        env: {
          CRADLE_CHAT_SESSION_ID: 'session-1',
          CRADLE_WORKSPACE_ID: 'workspace-1',
        },
      },
      chatgptAuth: null,
    })

    const fp2 = createCodexAppServerHostFingerprint({
      options: {
        apiKey: 'sk-test',
        config: {
          approval_policy: 'never', // different
          sandbox_mode: 'exec', // different
          model: 'gpt-3.5', // different
          // Different thread configs should not affect fingerprint
        },
        env: {
          CRADLE_CHAT_SESSION_ID: 'session-2', // different host-scope-owned context
          CRADLE_WORKSPACE_ID: 'workspace-2', // different host-scope-owned context
        },
      },
      chatgptAuth: null,
    })

    // The host scope owns Cradle session/workspace isolation; the fingerprint
    // only decides compatibility within that already-selected scope.
    expect(fp1).toBe(fp2)
  })

  it('includes process-level config in fingerprint', () => {
    const fp1 = createCodexAppServerHostFingerprint({
      options: {
        apiKey: 'sk-test',
        config: {},
      },
      chatgptAuth: null,
    })

    const fp2 = createCodexAppServerHostFingerprint({
      options: {
        apiKey: 'sk-test',
        config: {
          model_provider: 'custom',
          model_providers: {
            custom: { base_url: 'https://api.example.com' },
          },
        },
      },
      chatgptAuth: null,
    })

    // Different model_provider config should produce different fingerprint
    expect(fp1).not.toBe(fp2)
  })

  it('includes apiKey in fingerprint', () => {
    const fp1 = createCodexAppServerHostFingerprint({
      options: {
        apiKey: 'sk-test-1',
      },
      chatgptAuth: null,
    })

    const fp2 = createCodexAppServerHostFingerprint({
      options: {
        apiKey: 'sk-test-2',
      },
      chatgptAuth: null,
    })

    expect(fp1).not.toBe(fp2)
  })

  it('includes chatgptAuth in fingerprint', () => {
    const fp1 = createCodexAppServerHostFingerprint({
      options: {},
      chatgptAuth: {
        credentialRef: 'chatgpt-cred-1',
        chatgptAccountId: 'account-1',
        chatgptPlanType: 'plus',
        accessToken: 'token-1',
        refreshToken: null,
      },
    })

    const fp2 = createCodexAppServerHostFingerprint({
      options: {},
      chatgptAuth: {
        credentialRef: 'chatgpt-cred-2',
        chatgptAccountId: 'account-2',
        chatgptPlanType: 'team',
        accessToken: 'token-2',
        refreshToken: null,
      },
    })

    expect(fp1).not.toBe(fp2)
  })

  it('includes personal access token env in fingerprint', () => {
    const fp1 = createCodexAppServerHostFingerprint({
      options: {
        env: {
          CODEX_ACCESS_TOKEN: 'pat-token-1',
          CRADLE_CHAT_SESSION_ID: 'session-1',
        },
      },
      chatgptAuth: null,
    })

    const fp2 = createCodexAppServerHostFingerprint({
      options: {
        env: {
          CODEX_ACCESS_TOKEN: 'pat-token-2',
          CRADLE_CHAT_SESSION_ID: 'session-1',
        },
      },
      chatgptAuth: null,
    })

    expect(fp1).not.toBe(fp2)
  })

  it('includes Bedrock auth env and region in fingerprint', () => {
    const fp1 = createCodexAppServerHostFingerprint({
      options: {
        env: {
          AWS_BEARER_TOKEN_BEDROCK: 'bedrock-token-1',
          AWS_REGION: 'us-east-1',
        },
      },
      chatgptAuth: null,
    })

    const fp2 = createCodexAppServerHostFingerprint({
      options: {
        env: {
          AWS_BEARER_TOKEN_BEDROCK: 'bedrock-token-1',
          AWS_REGION: 'us-west-2',
        },
      },
      chatgptAuth: null,
    })

    expect(fp1).not.toBe(fp2)
  })

  it('includes codexPath in fingerprint', () => {
    const fp1 = createCodexAppServerHostFingerprint({
      options: {
        codexPath: '/usr/local/bin/codex',
      },
      chatgptAuth: null,
    })

    const fp2 = createCodexAppServerHostFingerprint({
      options: {
        codexPath: '/opt/codex/bin/codex',
      },
      chatgptAuth: null,
    })

    expect(fp1).not.toBe(fp2)
  })

  it('includes userAgentMode in fingerprint', () => {
    const fp1 = createCodexAppServerHostFingerprint({
      options: {
        userAgentMode: 'cradle',
      },
      chatgptAuth: null,
    })

    const fp2 = createCodexAppServerHostFingerprint({
      options: {
        userAgentMode: 'native',
      },
      chatgptAuth: null,
    })

    expect(fp1).not.toBe(fp2)
  })
})
