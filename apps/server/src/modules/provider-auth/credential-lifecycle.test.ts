import { afterEach, describe, expect, it, vi } from 'vitest'

import { resetCredentialLifecycleForTests, resolveFreshAccessToken } from './credential-lifecycle'

interface TestCredential {
  accessToken: string
  refreshToken: string
  fresh: boolean
}

const driver = {
  id: 'test-provider',
  parseCredential: (_credentialRef: string, secret: string): TestCredential =>
    JSON.parse(secret) as TestCredential,
  hasFreshAccessToken: (credential: TestCredential): boolean => credential.fresh,
  refreshCredential: async (credential: TestCredential): Promise<TestCredential> => ({
    accessToken: 'new-access-token',
    refreshToken: `${credential.refreshToken}-rotated`,
    fresh: true,
  }),
  serializeCredential: (credential: TestCredential): string => JSON.stringify(credential),
  isReauthRequired: (): boolean => false,
  createReauthRequiredError: (): Error => new Error('reauth required'),
}

afterEach(() => {
  resetCredentialLifecycleForTests()
})

describe('resolveFreshAccessToken', () => {
  it('coalesces concurrent refreshes and atomically persists the rotated credential', async () => {
    let secret = JSON.stringify({
      accessToken: 'expired-access-token',
      refreshToken: 'refresh-1',
      fresh: false,
    })
    const refreshCredential = vi.fn(
      async (credential: TestCredential): Promise<TestCredential> => ({
        accessToken: 'new-access-token',
        refreshToken: `${credential.refreshToken}-rotated`,
        fresh: true,
      }),
    )
    const updateSecretValue = vi.fn((_credentialRef: string, next: string) => {
      secret = next
    })
    const results = await Promise.all(
      Array.from({ length: 8 }).fill(resolveFreshAccessToken({
          credentialRef: 'credential-1',
          store: { readSecret: () => secret, updateSecretValue },
          driver: { ...driver, refreshCredential },
        })),
    )

    expect(refreshCredential).toHaveBeenCalledTimes(1)
    expect(updateSecretValue).toHaveBeenCalledTimes(1)
    expect(results).toEqual(
      Array.from({ length: 8 }).fill({
        accessToken: 'new-access-token',
        refreshToken: 'refresh-1-rotated',
        fresh: true,
      }),
    )
    expect(JSON.parse(secret)).toEqual(results[0])
  })

  it('does not refresh a credential outside its refresh window', async () => {
    const refreshCredential = vi.fn(driver.refreshCredential)
    const result = await resolveFreshAccessToken({
      credentialRef: 'credential-1',
      store: {
        readSecret: () =>
          JSON.stringify({
            accessToken: 'current-access-token',
            refreshToken: 'refresh-1',
            fresh: true,
          }),
        updateSecretValue: vi.fn(),
      },
      driver: { ...driver, refreshCredential },
    })

    expect(refreshCredential).not.toHaveBeenCalled()
    expect(result.accessToken).toBe('current-access-token')
  })

  it('does not overwrite a credential when a recoverable refresh failure occurs', async () => {
    const updateSecretValue = vi.fn()
    await expect(
      resolveFreshAccessToken({
        credentialRef: 'credential-1',
        store: {
          readSecret: () =>
            JSON.stringify({
              accessToken: 'expired-access-token',
              refreshToken: 'refresh-1',
              fresh: false,
            }),
          updateSecretValue,
        },
        driver: {
          ...driver,
          refreshCredential: async () => {
            throw new Error('network unavailable')
          },
        },
      }),
    ).rejects.toThrow('network unavailable')

    expect(updateSecretValue).not.toHaveBeenCalled()
  })
})
