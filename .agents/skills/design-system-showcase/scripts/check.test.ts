/**
 * Unit tests for scripts/check.ts
 *
 * Copy this file to scripts/check.test.ts in the target design-system package.
 * Run with: tsx --test scripts/check.test.ts
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  extractCheatsheetHex,
  extractTokens,
  lintTemplate,
  runChecks,
} from './check.ts'

test('extractTokens parses --color-* from @theme block', () => {
  const css = `
    @theme {
      --color-neutral-1: #f9f8f5;
      --color-neutral-9: #24231f;
      --color-accent: #c56473;
    }
  `
  const tokens = extractTokens(css)
  assert.equal(tokens.get('--color-neutral-1'), '#f9f8f5')
  assert.equal(tokens.get('--color-neutral-9'), '#24231f')
  assert.equal(tokens.get('--color-accent'), '#c56473')
})

test('extractCheatsheetHex parses hex values from markdown table cells', () => {
  const md = `
    | Var | Hex | Use |
    |---|---|---|
    | \`--color-neutral-1\` | \`#f9f8f5\` | Page bg |
    | \`--color-accent\` | \`#c56473\` | CTA |
  `
  const hexes = extractCheatsheetHex(md)
  assert.equal(hexes.get('--color-neutral-1'), '#f9f8f5')
  assert.equal(hexes.get('--color-accent'), '#c56473')
})

test('extractCheatsheetHex is case-insensitive for hex input', () => {
  const md = `| \`--color-accent\` | \`#C56473\` | CTA |`
  const hexes = extractCheatsheetHex(md)
  assert.equal(hexes.get('--color-accent'), '#c56473')
})

test('lintTemplate flags banned text-neutral-50 class', () => {
  const html = `<p class="text-neutral-500">Body copy</p>`
  const issues = lintTemplate(html, 'snippet.html')
  assert.equal(issues.length, 1)
  assert.match(issues[0], /text-neutral-500/)
})

test('lintTemplate flags banned bg-neutral-100 class', () => {
  const html = `<div class="bg-neutral-100">Card</div>`
  const issues = lintTemplate(html, 'snippet.html')
  assert.ok(issues.some((i) => i.includes('bg-neutral-100')))
})

test('lintTemplate flags raw hex inside inline style attribute', () => {
  const html = `<div style="color: #ff0000">!</div>`
  const issues = lintTemplate(html, 'snippet.html')
  assert.ok(issues.some((i) => i.includes('#ff0000')))
})

test('lintTemplate flags hardcoded font-family in inline style', () => {
  const html = `<p style="font-family: Georgia, serif">text</p>`
  const issues = lintTemplate(html, 'snippet.html')
  assert.ok(issues.some((i) => i.includes('font-family')))
})

test('lintTemplate accepts var(--color-...) references', () => {
  const html = `<div style="color: var(--color-neutral-9)">ok</div>`
  const issues = lintTemplate(html, 'snippet.html')
  assert.equal(issues.length, 0)
})

test('lintTemplate accepts white/black sentinels in inline style', () => {
  const html = `<button style="background: var(--color-accent); color: #ffffff;">ok</button>`
  const issues = lintTemplate(html, 'snippet.html')
  assert.equal(issues.length, 0)
})

test('lintTemplate accepts var(--font-...) for font-family', () => {
  const html = `<p style="font-family: var(--font-serif)">ok</p>`
  const issues = lintTemplate(html, 'snippet.html')
  assert.equal(issues.length, 0)
})

test('lintTemplate ignores hex inside <style> blocks (token declarations are allowed)', () => {
  const html = `<style>:root { --color-neutral-1: #f9f8f5; }</style><p>ok</p>`
  const issues = lintTemplate(html, 'scaffold.html')
  // style blocks use attr scanning so the :root declaration is safe
  assert.equal(issues.length, 0)
})

test('runChecks returns ok on consistent tokens + cheatsheet + no templates', () => {
  const result = runChecks({
    tokensCss: `@theme { --color-neutral-9: #24231f; }`,
    cheatsheetMd: `| \`--color-neutral-9\` | \`#24231f\` | Body |`,
    templates: [],
  })
  assert.equal(result.ok, true)
  assert.equal(result.issues.length, 0)
})

test('runChecks reports drift when cheatsheet hex disagrees with tokens', () => {
  const result = runChecks({
    tokensCss: `@theme { --color-neutral-9: #24231f; }`,
    cheatsheetMd: `| \`--color-neutral-9\` | \`#000000\` | Body |`,
    templates: [],
  })
  assert.equal(result.ok, false)
  assert.ok(result.issues[0].includes('--color-neutral-9'))
})

test('runChecks reports missing token referenced in cheatsheet', () => {
  const result = runChecks({
    tokensCss: `@theme { --color-accent: #c56473; }`,
    cheatsheetMd: `| \`--color-neutral-9\` | \`#24231f\` | Body |`,
    templates: [],
  })
  assert.equal(result.ok, false)
  assert.ok(result.issues[0].includes('--color-neutral-9'))
})

test('runChecks collects template lint errors alongside token drift', () => {
  const result = runChecks({
    tokensCss: `@theme { --color-neutral-9: #24231f; }`,
    cheatsheetMd: `| \`--color-neutral-9\` | \`#24231f\` | Body |`,
    templates: [
      { filename: 'templates/snippet.html', html: `<p class="text-neutral-500">x</p>` },
    ],
  })
  assert.equal(result.ok, false)
  assert.ok(result.issues.some((i) => i.includes('text-neutral-500')))
})
