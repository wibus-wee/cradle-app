import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { init, parse } from 'es-module-lexer'

const fixtureRoot = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(fixtureRoot, '../../../../..')
const repositoryRoot = resolve(desktopRoot, '../..')
const outputRoot = resolve(desktopRoot, 'dist/m0/fixture-resources')
const pluginOutput = resolve(outputRoot, 'system-info/web.mjs')
const dependencyOutput = resolve(outputRoot, 'deps')
const rootRequire = createRequire(resolve(repositoryRoot, 'package.json'))

const sharedDependencies = new Map([
  ['react', 'react.mjs'],
  ['react-dom', 'react-dom.mjs'],
  ['react/jsx-runtime', 'react-jsx-runtime.mjs'],
  ['react/jsx-dev-runtime', 'react-jsx-dev-runtime.mjs'],
  ['react-dom/client', 'react-dom-client.mjs'],
])

function isBareSpecifier(specifier) {
  return !specifier.startsWith('.')
    && !specifier.startsWith('/')
    && !/^[a-z][a-z0-9+.-]*:/i.test(specifier)
}

function buildDependencyWrapper(specifier) {
  const moduleExports = rootRequire(specifier)
  const namedExports = Object.keys(moduleExports)
    .filter(name => name !== 'default' && /^[A-Z_$][\w$]*$/i.test(name))
    .sort()
  return [
    `const __registry = window[Symbol.for('cradle:modules')];`,
    `const __mod = __registry?.[${JSON.stringify(specifier)}];`,
    `if (!__mod) { throw new Error(${JSON.stringify(`Cradle shared module is not available: ${specifier}`)}); }`,
    'export default __mod.default ?? __mod;',
    ...namedExports.map(name => `export const ${name} = __mod.${name};`),
    '',
  ].join('\n')
}

async function rewritePluginSource(source) {
  await init
  const [imports] = parse(source)
  let cursor = 0
  let rewritten = ''
  const usedDependencies = new Set()
  for (const record of imports) {
    if (record.n === undefined) { continue }
    const fileName = sharedDependencies.get(record.n)
    if (!fileName) {
      if (isBareSpecifier(record.n)) {
        throw new Error(`Unknown shared dependency in system-info web bundle: ${record.n}`)
      }
      continue
    }
    rewritten += source.slice(cursor, record.s)
    rewritten += `cradle-server://local/api/plugins/-/deps/${fileName}`
    cursor = record.e
    usedDependencies.add(record.n)
  }
  const result = cursor === 0 ? source : rewritten + source.slice(cursor)
  const [remainingImports] = parse(result)
  for (const record of remainingImports) {
    if (record.n !== undefined && sharedDependencies.has(record.n)) {
      throw new Error(`Known shared dependency remained bare after rewrite: ${record.n}`)
    }
  }
  return { source: result, usedDependencies }
}

async function main() {
  const sourcePath = resolve(repositoryRoot, 'plugins/system-info/dist/web.mjs')
  const source = await readFile(sourcePath, 'utf8')
  const rewritten = await rewritePluginSource(source)
  if (rewritten.usedDependencies.size === 0) {
    throw new Error('The real system-info bundle did not import any known shared dependency')
  }

  await rm(outputRoot, { recursive: true, force: true })
  await mkdir(dirname(pluginOutput), { recursive: true })
  await mkdir(dependencyOutput, { recursive: true })
  await writeFile(pluginOutput, rewritten.source, 'utf8')
  for (const specifier of rewritten.usedDependencies) {
    const fileName = sharedDependencies.get(specifier)
    await writeFile(resolve(dependencyOutput, fileName), buildDependencyWrapper(specifier), 'utf8')
  }
  await writeFile(resolve(outputRoot, 'manifest.json'), `${JSON.stringify({
    source: 'plugins/system-info/dist/web.mjs',
    sha256: createHash('sha256').update(rewritten.source).digest('hex'),
    dependencies: [...rewritten.usedDependencies].sort(),
  }, null, 2)}\n`, 'utf8')
  console.log(`[m0] prepared real system-info plugin with ${rewritten.usedDependencies.size} shared dependencies`)
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
