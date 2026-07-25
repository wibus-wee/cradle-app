import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
} from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'

import type { Json } from './protocol-utils'
import { asRecord, readJson, sha256, writeJson } from './protocol-utils'

const ROOT = resolve(import.meta.dirname, '..')
const CACHE_ROOT = resolve(ROOT, '.cache/protocol-artifacts')
const MANIFEST_PATH = resolve(ROOT, 'protocol/generated-artifacts.json')

export const GENERATED_FILES = [
  'anthropic-schemas.ts',
  'openai-schemas.ts',
  'corpus-manifest.json',
  'protocol-coverage.json',
] as const

type ArtifactGenerator = (outputDirectory: string) => Promise<void>

export interface GeneratedArtifactManifest {
  readonly inputFingerprint: string
  readonly files: Readonly<Record<(typeof GENERATED_FILES)[number], string>>
}

export interface ProtocolArtifactCache {
  readonly directory: string
  readonly fingerprint: string
}

export async function ensureProtocolArtifactCache(
  expectedFingerprint?: string,
  generate: ArtifactGenerator = defaultArtifactGenerator,
): Promise<ProtocolArtifactCache> {
  const fingerprint = await protocolArtifactInputFingerprint()
  if (expectedFingerprint && expectedFingerprint !== fingerprint) {
    throw new Error(
      `Protocol artifact inputs changed: expected ${expectedFingerprint}, got ${fingerprint}. Run protocol:generate.`,
    )
  }
  const directory = resolve(CACHE_ROOT, fingerprint)
  if (await hasCompleteArtifactSet(directory)) {
    await pruneStaleArtifactCaches(fingerprint)
    return { directory, fingerprint }
  }

  await mkdir(CACHE_ROOT, { recursive: true })
  const temporary = await mkdtemp(resolve(CACHE_ROOT, '.generating-'))
  try {
    await generate(temporary)
    try {
      await rename(temporary, directory)
    }
    catch (error) {
      if (!await hasCompleteArtifactSet(directory)) { throw error }
    }
  }
  finally {
    await rm(temporary, { recursive: true, force: true })
  }
  await pruneStaleArtifactCaches(fingerprint)
  return { directory, fingerprint }
}

export async function refreshProtocolArtifactCache(
  generate: ArtifactGenerator = defaultArtifactGenerator,
): Promise<ProtocolArtifactCache> {
  const cache = await ensureProtocolArtifactCache(undefined, generate)
  const files = Object.fromEntries(
    await Promise.all(GENERATED_FILES.map(async file => [
      file,
      sha256(await readFile(resolve(cache.directory, file))),
    ])),
  ) as GeneratedArtifactManifest['files']
  await writeJson(MANIFEST_PATH, {
    inputFingerprint: cache.fingerprint,
    files,
  } satisfies Json)
  return cache
}

export async function readGeneratedArtifactManifest(): Promise<GeneratedArtifactManifest> {
  const manifest = asRecord(await readJson(MANIFEST_PATH))
  return manifest as unknown as GeneratedArtifactManifest
}

export async function protocolArtifactInputFingerprint(): Promise<string> {
  const paths = [
    resolve(ROOT, 'package.json'),
    resolve(ROOT, 'node_modules/ajv/package.json'),
    resolve(ROOT, 'node_modules/ajv-formats/package.json'),
    ...await filesUnder(resolve(ROOT, 'protocol')),
    ...await filesUnder(resolve(ROOT, 'scripts')),
    ...await filesUnder(resolve(ROOT, 'src')),
  ].filter(path =>
    path !== MANIFEST_PATH
    && !path.includes(`${sep}src${sep}generated${sep}`))
  const hash = createHash('sha256')
  for (const path of [...new Set(paths)].sort()) {
    const label = relative(ROOT, path).split(sep).join('/')
    hash.update(label)
    hash.update('\0')
    hash.update(await readFile(path))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  }))
  return paths.flat()
}

async function hasCompleteArtifactSet(directory: string): Promise<boolean> {
  try {
    await Promise.all(GENERATED_FILES.map(file => access(resolve(directory, file))))
    return true
  }
  catch {
    return false
  }
}

async function pruneStaleArtifactCaches(currentFingerprint: string): Promise<void> {
  const entries = await readdir(CACHE_ROOT, { withFileTypes: true })
  await Promise.all(entries.map(async (entry) => {
    if (
      entry.isDirectory()
      && entry.name !== currentFingerprint
      && /^[a-f\d]{64}$/.test(entry.name)
    ) {
      await rm(resolve(CACHE_ROOT, entry.name), { recursive: true, force: true })
    }
  }))
}

async function defaultArtifactGenerator(outputDirectory: string): Promise<void> {
  const { generateProtocolArtifacts } = await import('./generate-protocol-artifacts')
  await generateProtocolArtifacts(outputDirectory)
}
