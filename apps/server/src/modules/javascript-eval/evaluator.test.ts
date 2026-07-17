import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluateCell } from './evaluator'

const TEST_TIMEOUT_MS = 15_000

describe('evaluateCell', () => {
  it('normalizes and runs a bare async function expression', async () => {
    const outcome = await evaluateCell({ program: 'async () => false;' })
    expect(outcome).toEqual({ kind: 'completed', result: false })
  }, TEST_TIMEOUT_MS)

  it('runs a complete ES module and returns a structured result', async () => {
    const outcome = await evaluateCell({
      program: `export default async () => ({ resumeText: 'done', payload: { a: 1 } })`,
    })
    expect(outcome).toEqual({ kind: 'completed', result: { resumeText: 'done', payload: { a: 1 } } })
  }, TEST_TIMEOUT_MS)

  it('runs in the requested workspace cwd', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cradle-js-eval-cwd-'))
    const resolvedCwd = realpathSync(cwd)
    try {
      const outcome = await evaluateCell({
        cwd,
        program: `async ({ cwd }) => ({ contextCwd: cwd, processCwd: process.cwd() })`,
      })
      expect(outcome).toEqual({
        kind: 'completed',
        result: { contextCwd: resolvedCwd, processCwd: resolvedCwd },
      })
    }
    finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }, TEST_TIMEOUT_MS)

  it('runs child processes through tools.exec', async () => {
    const program = `async ({ tools }) => {
      const result = await tools.exec({ argv: [process.execPath, '-e', 'console.log("hi")'] })
      return result.stdout.trim()
    }`
    const outcome = await evaluateCell({ program })
    expect(outcome).toEqual({ kind: 'completed', result: 'hi' })
  }, TEST_TIMEOUT_MS)

  it('reports a thrown cell as an execution error', async () => {
    const outcome = await evaluateCell({
      program: `async () => { throw new Error('boom') }`,
    })
    expect(outcome.kind).toBe('execution-error')
    if (outcome.kind === 'execution-error') {
      expect(outcome.error).toContain('boom')
    }
  }, TEST_TIMEOUT_MS)

  it('rejects a syntactically invalid program in check mode', async () => {
    const outcome = await evaluateCell({
      program: 'export default async () => {',
      mode: 'check',
    })
    expect(outcome.kind).toBe('program-error')
  }, TEST_TIMEOUT_MS)

  it('checks syntax without executing module top-level code', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'cradle-js-eval-check-'))
    const markerPath = join(cwd, 'side-effect.txt')
    try {
      const outcome = await evaluateCell({
        cwd,
        mode: 'check',
        program: `
          import { writeFileSync } from 'node:fs'
          writeFileSync(${JSON.stringify(markerPath)}, 'ran')
          export default async () => false
        `,
      })
      expect(outcome).toEqual({ kind: 'check-passed' })
      expect(existsSync(markerPath)).toBe(false)
    }
    finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  }, TEST_TIMEOUT_MS)

  it('reports a non-function default export as a program error when run', async () => {
    const outcome = await evaluateCell({ program: 'export default 42' })
    expect(outcome).toEqual({
      kind: 'program-error',
      error: 'Program must export a default function.',
    })
  }, TEST_TIMEOUT_MS)

  it('kills an infinite loop after the wall-clock timeout', async () => {
    const startedAt = Date.now()
    const outcome = await evaluateCell({
      program: `async () => { while (true) {} }`,
      timeoutMs: 500,
    })
    expect(outcome).toEqual({ kind: 'timeout' })
    expect(Date.now() - startedAt).toBeLessThan(10_000)
  }, TEST_TIMEOUT_MS)

  it('contains process.exit to the evaluator process', async () => {
    const outcome = await evaluateCell({
      program: `async () => { process.exit(17) }`,
    })
    expect(outcome.kind).toBe('crashed')
    if (outcome.kind === 'crashed') {
      expect(outcome.error).toContain('without a result')
    }
  }, TEST_TIMEOUT_MS)

  it('rejects non-cloneable results', async () => {
    const outcome = await evaluateCell({ program: `async () => ({ callback: () => {} })` })
    expect(outcome.kind).toBe('execution-error')
  }, TEST_TIMEOUT_MS)

  it('rejects oversized serialized results inside the evaluator process', async () => {
    const outcome = await evaluateCell({ program: `async () => 'x'.repeat(2 * 1024 * 1024)` })
    expect(outcome).toEqual({
      kind: 'execution-error',
      error: 'Cell result exceeds the 1048576 byte limit.',
    })
  }, TEST_TIMEOUT_MS)
})
