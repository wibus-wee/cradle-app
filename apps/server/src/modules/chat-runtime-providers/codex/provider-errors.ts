import { ProviderErrors, ProviderRuntimeError } from '../../chat-runtime/runtime-provider-types'
import { CODEX_RUNTIME_KIND } from './metadata'

/**
 * Build a codex provider runtime error for a failed app-server method call.
 * Shared by the provider facade and turn projection/generation helpers.
 */
export function codexRequestError(method: string, detail: string): ProviderRuntimeError {
  return new ProviderRuntimeError(ProviderErrors.requestFailed(CODEX_RUNTIME_KIND, method, detail))
}

/**
 * Best-effort stringification of an unknown error for error-detail fields.
 */
export function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
