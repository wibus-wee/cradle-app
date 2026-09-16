import { z } from 'zod'

import manifestJson from './claude-code-runtime-manifest.json'

export type ClaudeCodeLinuxLibc = 'glibc' | 'musl'

const releaseTargetSchema = z.object({
  packageName: z.string().min(1),
  tarball: z.string().startsWith('https://'),
  unpackedSizeBytes: z.number().int().positive(),
  sha512: z.string().regex(/^[a-f0-9]{128}$/),
})

const runtimeManifestSchema = z.object({
  schemaVersion: z.literal(1),
  sdkVersion: z.string().min(1),
  registry: z.string().startsWith('https://'),
  targets: z.record(z.string().min(1), releaseTargetSchema),
})

export type ClaudeCodeRuntimeManifest = z.infer<typeof runtimeManifestSchema>

export interface ResolvedClaudeCodeReleaseTarget {
  key: string
  version: string
  packageName: string
  downloadUrl: string
  unpackedSizeBytes: number
  sha512: string
  executableName: 'claude' | 'claude.exe'
}

export const CLAUDE_CODE_RUNTIME_MANIFEST: ClaudeCodeRuntimeManifest = runtimeManifestSchema.parse(manifestJson)

/**
 * Mirrors the SDK's own libc heuristic (`process.report` glibc presence):
 * Linux hosts without a glibc runtime are treated as musl.
 */
export function detectClaudeCodeLinuxLibc(): ClaudeCodeLinuxLibc {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined
  return report?.header?.glibcVersionRuntime ? 'glibc' : 'musl'
}

/**
 * Maps platform/arch/libc onto the npm platform-package suffixes the SDK itself
 * resolves (`@anthropic-ai/claude-agent-sdk-<key>`), including the SDK's
 * glibc→musl fallback order on Linux.
 */
export function resolveClaudeCodeReleaseTarget(input: {
  platform?: NodeJS.Platform
  arch?: string
  libc?: ClaudeCodeLinuxLibc | null
} = {}): ResolvedClaudeCodeReleaseTarget | null {
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const libc = input.libc === undefined && platform === 'linux' ? detectClaudeCodeLinuxLibc() : input.libc
  const keys = platform === 'linux'
    ? libc === 'musl'
      ? [`linux-${arch}-musl`, `linux-${arch}`]
      : [`linux-${arch}`, `linux-${arch}-musl`]
    : platform === 'darwin' || platform === 'win32'
      ? [`${platform}-${arch}`]
      : []
  for (const key of keys) {
    const asset = CLAUDE_CODE_RUNTIME_MANIFEST.targets[key]
    if (!asset) {
      continue
    }
    return {
      key,
      version: CLAUDE_CODE_RUNTIME_MANIFEST.sdkVersion,
      packageName: asset.packageName,
      downloadUrl: asset.tarball,
      unpackedSizeBytes: asset.unpackedSizeBytes,
      sha512: asset.sha512,
      executableName: platform === 'win32' ? 'claude.exe' : 'claude',
    }
  }
  return null
}
