import { AppError } from '../../errors/app-error'

/**
 * Validate Agent Artifact JSX source: only `cradle/artifact` (+ optional `react`) imports,
 * no dynamic code loading, and a default export.
 */
export function assertValidArtifactSource(source: string): void {
  const errors: string[] = []

  const importPattern = /^\s*import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/gm
  const allowedSpecifiers = new Set(['cradle/artifact', 'react', 'react/jsx-runtime'])
  let sawArtifactImport = false

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[2] ?? ''
    if (specifier === 'cradle/artifact') {
      sawArtifactImport = true
      continue
    }
    if (!allowedSpecifiers.has(specifier)) {
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
  if (/\bprocess\s*[.[]/.test(source) || /\bDeno\s*[.[]/.test(source) || /\bBun\s*[.[]/.test(source)) {
    errors.push('Runtime globals (process/Deno/Bun) are not allowed in Artifact source.')
  }
  if (!/\bexport\s+default\b/.test(source)) {
    errors.push('Artifact source must include `export default` for the root component.')
  }

  if (errors.length > 0) {
    throw new AppError({
      code: 'chat_artifact_source_invalid',
      status: 400,
      message: errors.join(' '),
      details: { errors },
    })
  }
}
