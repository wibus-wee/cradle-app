import { createArtifactModuleExports } from '@cradle/artifact'
import * as React from 'react'
import { transform } from 'sucrase'

const ALLOWED_SPECIFIERS = new Set(['cradle/artifact', 'react', 'react/jsx-runtime'])

export class ArtifactCompileError extends Error {
  readonly details: string[]

  constructor(message: string, details: string[] = []) {
    super(message)
    this.name = 'ArtifactCompileError'
    this.details = details
  }
}

export interface CompiledArtifactModule {
  default: React.ComponentType
}

/**
 * Compile constrained Artifact JSX into a default-export React component.
 * Only `cradle/artifact` and `react` imports are allowed; they are injected
 * via a module map (no network, no app imports).
 */
export function compileArtifactSource(source: string): CompiledArtifactModule {
  const details = validateArtifactSource(source)
  if (details.length > 0) {
    throw new ArtifactCompileError(details.join(' '), details)
  }

  let transformed: string
  try {
    transformed = transform(source, {
      transforms: ['typescript', 'jsx', 'imports'],
      production: true,
    }).code
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ArtifactCompileError(`Failed to transpile Artifact source: ${message}`)
  }

  const artifactExports = createArtifactModuleExports()
  const module = { exports: {} as Record<string, unknown> }
  const requireFn = (specifier: string): unknown => {
    if (specifier === 'cradle/artifact') {
      return artifactExports
    }
    if (specifier === 'react' || specifier === 'react/jsx-runtime') {
      return React
    }
    throw new ArtifactCompileError(`Disallowed runtime require "${specifier}".`)
  }

  try {
    // Constrained Artifact host: Sucrase rewrites imports to require(); we inject
    // only cradle/artifact + react. Function is the intentional sandbox entry.
    // eslint-disable-next-line no-new-func -- Artifact host evaluates allowlisted JSX only
    const factory = new Function('exports', 'require', 'module', 'React', transformed)
    factory(module.exports, requireFn, module, React)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ArtifactCompileError(`Failed to evaluate Artifact source: ${message}`)
  }

  const component = (module.exports.default ?? (module.exports as { default?: unknown }).default) as unknown
  if (typeof component !== 'function') {
    throw new ArtifactCompileError('Artifact source must export default a React component function.')
  }

  return { default: component as React.ComponentType }
}

function validateArtifactSource(source: string): string[] {
  const errors: string[] = []
  const importPattern = /^\s*import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm
  let sawArtifactImport = false

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[2] ?? ''
    if (specifier === 'cradle/artifact') {
      sawArtifactImport = true
      continue
    }
    if (!ALLOWED_SPECIFIERS.has(specifier)) {
      errors.push(`Disallowed import "${specifier}". Only "cradle/artifact" and "react" are allowed.`)
    }
  }

  if (!sawArtifactImport) {
    errors.push('Artifact source must import from "cradle/artifact".')
  }
  if (/\brequire\s*\(/.test(source)) {
    errors.push('require() is not allowed in Artifact source.')
  }
  if (/\bimport\s*\(/.test(source)) {
    errors.push('Dynamic import() is not allowed in Artifact source.')
  }
  if (/\beval\s*\(/.test(source)) {
    errors.push('eval() is not allowed in Artifact source.')
  }
  if (/\bnew\s+Function\b/.test(source)) {
    errors.push('new Function() is not allowed in Artifact source.')
  }
  if (!/\bexport\s+default\b/.test(source)) {
    errors.push('Artifact source must include `export default` for the root component.')
  }
  return errors
}
