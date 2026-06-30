/**
 * Design-system token verification script.
 *
 * Checks three things:
 *   1. Every hex value in CHEATSHEET.md matches the corresponding token in src/tokens.css
 *   2. No templates/**\/*.html file uses banned Tailwind neutral classes (50…950)
 *   3. No templates/**\/*.html file uses raw hex in inline style attributes
 *
 * Copy this file to scripts/check.ts in the target design-system package.
 * Run with: tsx scripts/check.ts
 */

import { readdir, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HEX_RE = /#[\da-f]{3,8}\b/i

/**
 * Matches Tailwind's built-in neutral-50…950 scale — the one banned by most
 * design systems that override --color-neutral-N with their own tokens.
 * If your project does NOT ban these, remove or adjust this pattern.
 */
const BANNED_NEUTRAL_CLASS =
  /\b(?:text|bg|border|ring|fill|stroke|from|to|via)-neutral-(?:50|100|200|300|400|500|600|700|800|900|950)\b/g

/**
 * Pure #fff / #000 sentinels are universally allowed in inline styles as they
 * carry strong semantic meaning that token aliases would not improve.
 */
const ALLOWED_HEX_VALUES = new Set(['#fff', '#ffffff', '#000', '#000000'])

/** Parse all --color-* and --font-* CSS variable declarations from a @theme block. */
export function extractTokens(css: string): Map<string, string> {
  const result = new Map<string, string>()
  const re = /(--color-[\da-z-]+|--font-[\da-z-]+):\s*([^;]+);/g
  for (const match of css.matchAll(re)) {
    const name = match[1]
    const value = match[2].trim()
    const hex = value.match(HEX_RE)
    if (hex) {
      result.set(name, hex[0].toLowerCase())
    } else {
      result.set(name, value)
    }
  }
  return result
}

/** Extract `--var-name` → `#hex` pairs from markdown table cells in CHEATSHEET.md. */
export function extractCheatsheetHex(md: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of md.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    let varName: string | undefined
    let hexValue: string | undefined
    for (const cell of trimmed.split('|').map((c) => c.trim())) {
      const varMatch = cell.match(/`(--[\da-z-]+)`/)
      if (varMatch) varName = varMatch[1]
      const hexMatch = cell.match(/`(#[\da-f]{3,8})`/i)
      if (hexMatch) hexValue = hexMatch[1].toLowerCase()
    }
    if (varName && hexValue) result.set(varName, hexValue)
  }
  return result
}

/** Lint a single HTML template file for contract violations. */
export function lintTemplate(html: string, filename: string): string[] {
  const issues: string[] = []

  // Banned Tailwind neutral scale
  for (const match of html.matchAll(BANNED_NEUTRAL_CLASS)) {
    issues.push(
      `${filename}: banned Tailwind class "${match[0]}" (use --color-neutral-1..10)`,
    )
  }

  // Raw hex in inline style="" attributes
  const styleAttrs = html.match(/\sstyle="[^"]*"/g) ?? []
  for (const attr of styleAttrs) {
    const hexes = attr.match(/#[\da-f]{3,8}\b/gi) ?? []
    for (const hex of hexes) {
      if (!ALLOWED_HEX_VALUES.has(hex.toLowerCase())) {
        issues.push(
          `${filename}: raw hex ${hex} in inline style (use var(--color-...))`,
        )
      }
    }

    const fontDecls = attr.match(/font-family:\s*([^";]+)/g) ?? []
    for (const decl of fontDecls) {
      const value = decl.replace(/^font-family:\s*/, '').trim()
      if (!value.startsWith('var(') && value !== 'inherit') {
        issues.push(
          `${filename}: hardcoded font-family "${value}" in inline style (use var(--font-...))`,
        )
      }
    }
  }

  return issues
}

export function runChecks(input: {
  tokensCss: string
  cheatsheetMd: string
  templates: { filename: string; html: string }[]
}): { ok: boolean; issues: string[] } {
  const issues: string[] = []
  const tokens = extractTokens(input.tokensCss)
  const cheatsheetHexes = extractCheatsheetHex(input.cheatsheetMd)

  for (const [name, hex] of cheatsheetHexes) {
    const tokenHex = tokens.get(name)
    if (!tokenHex) {
      issues.push(
        `cheatsheet references ${name} but it is not declared in tokens.css`,
      )
      continue
    }
    if (tokenHex !== hex) {
      issues.push(
        `drift: ${name} = ${tokenHex} in tokens.css vs ${hex} in CHEATSHEET.md`,
      )
    }
  }

  for (const tmpl of input.templates) {
    issues.push(...lintTemplate(tmpl.html, tmpl.filename))
  }

  return { ok: issues.length === 0, issues }
}

async function readTemplates(
  dir: string,
): Promise<{ filename: string; html: string }[]> {
  const result: { filename: string; html: string }[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        result.push(...(await readTemplates(full)))
      } else if (e.name.endsWith('.html')) {
        result.push({
          filename: relative(process.cwd(), full),
          html: await readFile(full, 'utf8'),
        })
      }
    }
  } catch {
    // templates/ directory is optional
  }
  return result
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const root = join(here, '..')
  const tokensCss = await readFile(join(root, 'src/tokens.css'), 'utf8')
  const cheatsheetMd = await readFile(join(root, 'CHEATSHEET.md'), 'utf8')
  const templates = await readTemplates(join(root, 'templates'))

  const result = runChecks({ tokensCss, cheatsheetMd, templates })

  if (!result.ok) {
    console.error('Check failed:')
    for (const issue of result.issues) console.error(`  - ${issue}`)
    process.exit(1)
  }
  const tokenCount = extractTokens(tokensCss).size
  console.log(
    `OK: ${tokenCount} tokens, ${templates.length} templates lint clean.`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
