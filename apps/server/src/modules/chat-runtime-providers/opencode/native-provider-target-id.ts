/**
 * Output: opencode runtime-owned provider target id encoding.
 * Input: opencode native provider ids.
 * Position: lightweight opencode target identity helper without runtime host dependencies.
 */

export const OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_ID = 'runtime-native-opencode'
export const OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_PREFIX = 'runtime-native:opencode:'

export function toOpenCodeRuntimeNativeProviderTargetId(nativeProviderId: string): string {
  return `${OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_PREFIX}${encodeURIComponent(nativeProviderId)}`
}

export function readOpenCodeRuntimeNativeProviderId(providerTargetId: string | null | undefined): string | null {
  if (!providerTargetId?.startsWith(OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_PREFIX)) {
    return null
  }
  const encoded = providerTargetId.slice(OPENCODE_RUNTIME_NATIVE_PROVIDER_TARGET_PREFIX.length)
  if (!encoded) {
    return null
  }
  try {
    return decodeURIComponent(encoded)
  }
  catch {
    return null
  }
}

export function isOpenCodeRuntimeNativeProviderTargetId(providerTargetId: string | null | undefined): boolean {
  return readOpenCodeRuntimeNativeProviderId(providerTargetId) !== null
}
