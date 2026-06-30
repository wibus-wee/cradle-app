import type { createConfig } from '../api-gen/client'
import { createClient } from '../api-gen/client'
import { getServerUrl } from './electron'

// createClientConfig is called by the generated code to inject per-request config.
// Return a config object that merges baseUrl into every request.
export function createClientConfig(config: Parameters<typeof createConfig>[0]) {
  return {
    ...config,
    baseUrl: getServerUrl(),
  }
}

/**
 * Unless you need to bypass api-gen's react-query integration, do not use this client directly.
 */
export const client = createClient(createClientConfig({}))
