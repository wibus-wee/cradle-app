import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

import ts from 'typescript'

const sourceRoot = resolve(import.meta.dirname, '../src')
const modulesRoot = join(sourceRoot, 'modules')
const MAX_RUNTIME_DOMAIN_SCC = 23
const FORBIDDEN_RUNTIME_EDGES = new Set([
  'relay-transport->remote-hosts',
])

function listSourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    const stats = statSync(path)
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(path))
    }
    else if (/\.(?:ts|tsx)$/.test(name) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(name)) {
      files.push(path)
    }
  }
  return files
}

function resolveImport(importer: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {
    return null
  }
  const base = resolve(dirname(importer), specifier)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    try {
      if (statSync(candidate).isFile()) {
        return candidate
      }
    }
    catch {
      // Try the next TypeScript resolution candidate.
    }
  }
  return null
}

function readDomain(path: string): string | null {
  const pathFromModules = relative(modulesRoot, path)
  if (pathFromModules.startsWith('..')) {
    return null
  }
  return pathFromModules.split(sep)[0] ?? null
}

function isRuntimeImport(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause
  if (!clause || clause.isTypeOnly) {
    return false
  }
  if (clause.name || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)) {
    return true
  }
  return clause.namedBindings.elements.some(element => !element.isTypeOnly)
}

const graph = new Map<string, Set<string>>()
const violations: string[] = []

for (const file of listSourceFiles(sourceRoot)) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const importerDomain = readDomain(file)
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !isRuntimeImport(statement)) {
      continue
    }
    const specifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null
    const imported = specifier ? resolveImport(file, specifier) : null
    if (!imported) {
      continue
    }
    const importedDomain = readDomain(imported)
    if (importerDomain && importedDomain && importerDomain !== importedDomain) {
      const targets = graph.get(importerDomain) ?? new Set<string>()
      targets.add(importedDomain)
      graph.set(importerDomain, targets)
      const edge = `${importerDomain}->${importedDomain}`
      if (FORBIDDEN_RUNTIME_EDGES.has(edge)) {
        violations.push(`${relative(sourceRoot, file)} restores forbidden runtime edge ${edge}`)
      }
      const importedRelative = relative(modulesRoot, imported).split(sep)
      if (importedRelative.includes('internal')) {
        violations.push(`${relative(sourceRoot, file)} imports ${relative(sourceRoot, imported)}`)
      }
    }
  }
}

function stronglyConnectedComponents(input: Map<string, Set<string>>): string[][] {
  let nextIndex = 0
  const indexes = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const components: string[][] = []

  const visit = (node: string): void => {
    indexes.set(node, nextIndex)
    lowLinks.set(node, nextIndex)
    nextIndex++
    stack.push(node)
    onStack.add(node)
    for (const target of input.get(node) ?? []) {
      if (!indexes.has(target)) {
        visit(target)
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(target)!))
      }
      else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indexes.get(target)!))
      }
    }
    if (lowLinks.get(node) !== indexes.get(node)) {
      return
    }
    const component: string[] = []
    let current: string
    do {
      current = stack.pop()!
      onStack.delete(current)
      component.push(current)
    } while (current !== node)
    components.push(component.toSorted())
  }

  const nodes = new Set([...input.keys(), ...[...input.values()].flatMap(targets => [...targets])])
  for (const node of [...nodes].toSorted()) {
    if (!indexes.has(node)) {
      visit(node)
    }
  }
  return components.toSorted((left, right) => right.length - left.length)
}

const components = stronglyConnectedComponents(graph)
const largest = components[0] ?? []
if (process.env.CRADLE_BOUNDARY_DEBUG === '1') {
  for (const domain of largest) {
    console.warn(`${domain} -> ${[...(graph.get(domain) ?? [])].toSorted().join(', ')}`)
  }
}
if (largest.length > MAX_RUNTIME_DOMAIN_SCC) {
  violations.push(`runtime domain SCC grew to ${largest.length}: ${largest.join(', ')}`)
}

if (violations.length > 0) {
  throw new Error(`Module boundary violations:\n${violations.map(value => `- ${value}`).join('\n')}`)
}

console.warn(`Module boundary check passed; largest runtime domain SCC: ${largest.length} (${largest.join(', ')})`)
