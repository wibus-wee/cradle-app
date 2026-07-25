import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createGenerator } from 'ts-json-schema-generator'
import { parse } from 'yaml'

import scopeJson from '../protocol/core-scope.json'
import type { Json } from './protocol-utils'
import {
  pruneLocalDefinitions,
  retainAllowlistedDiscriminatedBranches,
  serialize,
  sha256,
  writeJson,
} from './protocol-utils'

const ROOT = resolve(import.meta.dirname, '..')
const names = [
  'AnthropicMessageCreateParams',
  'AnthropicMessageCountTokensParams',
  'AnthropicMessage',
  'AnthropicMessageTokensCount',
  'AnthropicRawMessageStreamEvent',
  'AnthropicModelInfo',
  'AnthropicModelListParams',
  'AnthropicModelRetrieveParams',
  'AnthropicErrorResponse',
  'AnthropicBetaMessageCreateParams',
  'AnthropicBetaMessageCountTokensParams',
  'AnthropicBetaMessage',
  'AnthropicBetaMessageTokensCount',
  'AnthropicBetaRawMessageStreamEvent',
  'AnthropicBetaModelInfo',
  'AnthropicBetaModelListParams',
  'AnthropicBetaModelRetrieveParams',
] as const
async function main(): Promise<void> {
  const sdkRoot = resolve(ROOT, 'node_modules/anthropic-sdk-0-115')
  const packageText = await readFile(resolve(sdkRoot, 'package.json'), 'utf8')
  const packageJson = JSON.parse(packageText) as { version: string }
  const entry = resolve(ROOT, 'protocol/anthropic/schema-entry.ts')
  const generator = createGenerator({
    path: entry,
    tsconfig: resolve(ROOT, 'tsconfig.test.json'),
    type: '*',
    expose: 'export',
    topRef: true,
    skipTypeCheck: false,
  })
  const allowed = new Set([
    ...scopeJson.anthropic.events,
    ...scopeJson.anthropic.contentBlocks,
    ...scopeJson.anthropic.deltas,
    ...scopeJson.anthropic.requestTypes,
    ...scopeJson.anthropic.supportTypes,
  ])
  const catalogues: Record<string, Json> = {}
  for (const name of names) {
    const schema = generator.createSchema(name) as Json
    const filtered = retainAllowlistedDiscriminatedBranches(schema, schema, allowed)
    catalogues[name] = pruneLocalDefinitions(filtered)
  }
  const catalogue: Json = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    catalogues,
  }
  const schemaText = serialize(catalogue)
  const coreScopeText = await readFile(resolve(ROOT, 'protocol/core-scope.json'))
  const grammarText = await readFile(resolve(ROOT, 'protocol/anthropic/stream-grammar.json'))
  const transitionCorpusText = await readFile(
    resolve(ROOT, 'protocol/anthropic/transition-corpus.json'),
  )
  const declarationPaths = [
    'resources/messages/messages.d.ts',
    'resources/models.d.ts',
    'resources/shared.d.ts',
    'resources/beta/messages/messages.d.ts',
    'resources/beta/models.d.ts',
  ]
  const declarations = await Promise.all(
    declarationPaths.map(async path => ({
      path,
      sha256: sha256(await readFile(resolve(sdkRoot, path))),
    })),
  )
  await writeJson(resolve(ROOT, 'protocol/anthropic/schema.json'), catalogue)
  await writeJson(resolve(ROOT, 'protocol/anthropic/MANIFEST.json'), {
    owner: '@cradle/model-api-simulator',
    provider: 'anthropic',
    sdkVersion: packageJson.version,
    packageIntegrity: await readPackageIntegrity(packageJson.version),
    selectedTypes: [...names],
    declarations,
    schemaSha256: sha256(schemaText),
    coreScopeSha256: sha256(coreScopeText),
    grammarSha256: sha256(grammarText),
    transitionCorpusSha256: sha256(transitionCorpusText),
    generatedAt: new Date().toISOString(),
    refreshCommand: 'pnpm protocol:refresh:anthropic',
  })
}

async function readPackageIntegrity(version: string): Promise<string> {
  const lockPath = resolve(ROOT, '../../pnpm-lock.yaml')
  const lock = parse(await readFile(lockPath, 'utf8')) as {
    packages?: Record<string, { resolution?: { integrity?: string } }>
  }
  const entry = lock.packages?.[`@anthropic-ai/sdk@${version}`]
  const integrity = entry?.resolution?.integrity
  if (!integrity) {
    throw new Error(`pnpm lockfile has no integrity for @anthropic-ai/sdk@${version}`)
  }
  return integrity
}

await main()
