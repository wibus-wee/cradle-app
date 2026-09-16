import { z } from 'zod'

import manifestJson from './codex-runtime-manifest.json'

export type CodexArchiveFormat = 'tar.gz'
const targetKeys = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
] as const
export type CodexTargetKey = (typeof targetKeys)[number]

export interface CodexReleaseAsset {
  assetName: string
  format: CodexArchiveFormat
  sizeBytes: number
  sha256: string
}

const releaseAssetSchema = z.object({
  assetName: z.string().min(1),
  format: z.literal('tar.gz'),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
})

const runtimeManifestSchema = z.object({
  schemaVersion: z.literal(1),
  sdkVersion: z.string().min(1),
  releaseTag: z.string().min(1),
  repository: z.literal('openai/codex'),
  targets: z.record(z.enum(targetKeys), z.object({
    appServer: releaseAssetSchema,
    codeModeHost: releaseAssetSchema,
  })),
})

export type CodexRuntimeManifest = z.infer<typeof runtimeManifestSchema>

export interface ResolvedCodexReleaseAsset extends CodexReleaseAsset {
  downloadUrl: string
  executableName: string
  /** Basenames the archive payload may use, in preference order. */
  candidateBasenames: string[]
}

export interface ResolvedCodexReleaseTarget {
  key: CodexTargetKey
  version: string
  releaseTag: string
  appServer: ResolvedCodexReleaseAsset
  codeModeHost: ResolvedCodexReleaseAsset
}

export const CODEX_RUNTIME_MANIFEST: CodexRuntimeManifest = runtimeManifestSchema.parse(manifestJson)

/**
 * Target triples published by `codex-rs` releases. The archive payload names
 * its binary either plainly (`codex-app-server`) or with the target triple
 * suffix, so both basenames stay acceptable during extraction.
 */
const targetTriples: Record<CodexTargetKey, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

function resolveAsset(
  asset: CodexReleaseAsset,
  binaryStem: 'codex-app-server' | 'codex-code-mode-host',
  key: CodexTargetKey,
  platform: NodeJS.Platform,
): ResolvedCodexReleaseAsset {
  const executableName = platform === 'win32' ? `${binaryStem}.exe` : binaryStem
  const triple = targetTriples[key]
  return {
    ...asset,
    downloadUrl: `https://github.com/${CODEX_RUNTIME_MANIFEST.repository}/releases/download/${CODEX_RUNTIME_MANIFEST.releaseTag}/${asset.assetName}`,
    executableName,
    candidateBasenames: [
      executableName,
      `${binaryStem}-${triple}`,
      `${binaryStem}-${triple}.exe`,
    ],
  }
}

export function resolveCodexReleaseTarget(input: {
  platform?: NodeJS.Platform
  arch?: string
} = {}): ResolvedCodexReleaseTarget | null {
  const platform = input.platform ?? process.platform
  const arch = input.arch ?? process.arch
  const key = (platform === 'darwin' || platform === 'linux' || platform === 'win32')
    && (arch === 'arm64' || arch === 'x64')
    ? `${platform}-${arch}` as CodexTargetKey
    : null
  if (!key) {
    return null
  }
  const target = CODEX_RUNTIME_MANIFEST.targets[key]
  if (!target) {
    return null
  }
  return {
    key,
    version: CODEX_RUNTIME_MANIFEST.sdkVersion,
    releaseTag: CODEX_RUNTIME_MANIFEST.releaseTag,
    appServer: resolveAsset(target.appServer, 'codex-app-server', key, platform),
    codeModeHost: resolveAsset(target.codeModeHost, 'codex-code-mode-host', key, platform),
  }
}
