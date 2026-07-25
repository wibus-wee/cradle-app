import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { createGenerator } from 'ts-json-schema-generator'

import scopeJson from '../protocol/core-scope.json'
import type { Json } from './protocol-utils'
import {
  filterDiscriminatedBranches,
  pruneLocalDefinitions,
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
const excludedMarkers = [
  'mcp',
  'image',
  'audio',
  'bash',
  'shell',
  'text_editor',
  'memory',
  'tool_search',
  'web_search',
  'file_search',
  'web_fetch',
  'code_execution',
  'computer',
  'citation',
  'server_tool',
  'custom_tool',
]

async function main(): Promise<void> {
  const sdkRoot = resolve(ROOT, 'node_modules/@anthropic-ai/sdk')
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
  ])
  const catalogues: Record<string, Json> = {}
  for (const name of names) {
    const schema = generator.createSchema(name) as Json
    const filtered = filterDiscriminatedBranches(schema, allowed, excludedMarkers)
    if (!filtered) { throw new Error(`Selected Anthropic type ${name} was filtered to nothing`) }
    catalogues[name] = pruneLocalDefinitions(filtered)
  }
  const catalogue: Json = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    catalogues,
  }
  const schemaText = serialize(catalogue)
  const coreScopeText = await readFile(resolve(ROOT, 'protocol/core-scope.json'))
  const grammarText = await readFile(resolve(ROOT, 'protocol/anthropic/stream-grammar.json'))
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
    packageIntegrity: null,
    selectedTypes: [...names],
    declarations,
    schemaSha256: sha256(schemaText),
    coreScopeSha256: sha256(coreScopeText),
    grammarSha256: sha256(grammarText),
    generatedAt: new Date().toISOString(),
    refreshCommand: 'pnpm protocol:refresh:anthropic',
  })
}

await main()
