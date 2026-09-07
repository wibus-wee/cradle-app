import { CODEX_NATIVE_CONFIG_KEYS } from '../../../provider-contracts/codex-native-config'
import type { CodexAppServerClientOptions } from './client'

/** Keep provider overrides at process scope; Cradle-owned invocation data stays on thread requests. */
export function projectCodexProcessConfig(config: CodexAppServerClientOptions['config']) {
  return Object.fromEntries(
    Object.entries(config ?? {}).filter(
      ([key]) =>
        key === 'model_provider' || key === 'model_providers' || CODEX_NATIVE_CONFIG_KEYS.has(key),
    ),
  )
}
