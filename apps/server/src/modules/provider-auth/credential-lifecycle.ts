/**
 * Coordinates refreshes for encrypted credentials without retaining a token cache.
 * Provider-specific token parsing, expiry, refresh, and error semantics stay in
 * each provider driver.
 */
export interface CredentialLifecycleStore {
  readSecret: (credentialRef: string) => string
  updateSecretValue: (credentialRef: string, secret: string) => void
}

export interface CredentialAuthDriver<TCredential> {
  readonly id: string
  parseCredential: (credentialRef: string, secret: string) => TCredential
  hasFreshAccessToken: (credential: TCredential) => boolean
  refreshCredential: (credential: TCredential) => Promise<TCredential>
  serializeCredential: (credential: TCredential) => string
  isReauthRequired: (error: unknown) => boolean
  createReauthRequiredError: () => Error
}

export interface ResolveFreshAccessTokenInput<TCredential> {
  credentialRef: string
  store: CredentialLifecycleStore
  driver: CredentialAuthDriver<TCredential>
  forceRefresh?: boolean
}

const inFlightRefreshes = new Map<string, Promise<unknown>>()

/**
 * Reads the durable credential on every call. Expiring credentials share one
 * refresh per driver/ref pair; the refresh owner re-reads before refreshing so
 * token rotation by a prior caller cannot be overwritten.
 */
export async function resolveFreshAccessToken<TCredential>(
  input: ResolveFreshAccessTokenInput<TCredential>,
): Promise<TCredential> {
  const current = readCredential(input)
  if (!input.forceRefresh && input.driver.hasFreshAccessToken(current)) {
    return current
  }

  const key = `${input.driver.id}:${input.credentialRef}`
  const existing = inFlightRefreshes.get(key) as Promise<TCredential> | undefined
  if (existing) {
    return await existing
  }

  const refresh = refreshCredential(input)
  inFlightRefreshes.set(key, refresh)
  try {
    return await refresh
  }
 finally {
    if (inFlightRefreshes.get(key) === refresh) {
      inFlightRefreshes.delete(key)
    }
  }
}

function readCredential<TCredential>(
  input: ResolveFreshAccessTokenInput<TCredential>,
): TCredential {
  return input.driver.parseCredential(
    input.credentialRef,
    input.store.readSecret(input.credentialRef),
  )
}

async function refreshCredential<TCredential>(
  input: ResolveFreshAccessTokenInput<TCredential>,
): Promise<TCredential> {
  // The caller that won single-flight must observe the latest durable value.
  const current = readCredential(input)
  if (!input.forceRefresh && input.driver.hasFreshAccessToken(current)) {
    return current
  }

  try {
    const refreshed = await input.driver.refreshCredential(current)
    input.store.updateSecretValue(input.credentialRef, input.driver.serializeCredential(refreshed))
    return refreshed
  }
 catch (error) {
    if (input.driver.isReauthRequired(error)) {
      throw input.driver.createReauthRequiredError()
    }
    throw error
  }
}

export function resetCredentialLifecycleForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Credential lifecycle reset is test-only')
  }
  inFlightRefreshes.clear()
}
