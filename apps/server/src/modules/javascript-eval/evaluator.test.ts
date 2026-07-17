import { describe, expect, it } from 'vitest'

import { evaluateCell } from './evaluator'

const TEST_TIMEOUT_MS = 15_000

describe('evaluateCell', () => {
  it('completes with a false result', async () => {
    const outcome = await evaluateCell({ program: 'export default async () => false' })
    expect(outcome).toEqual({ kind: 'completed', result: false })
  }, TEST_TIMEOUT_MS)

  it('completes with a structured result object', async () => {
    const outcome = await evaluateCell({
      program: `export default async () => ({ resumeText: 'done', payload: { a: 1 } })`,
    })
    expect(outcome).toEqual({ kind: 'completed', result: { resumeText: 'done', payload: { a: 1 } } })
  }, TEST_TIMEOUT_MS)

  it('runs child processes through tools.exec', async () => {
    const program = `export default async ({ tools }) => {
      const result = await tools.exec({ argv: [process.execPath, '-e', 'console.log("hi")'] })
      return result.stdout.trim()
    }`
    const outcome = await evaluateCell({ program })
    expect(outcome).toEqual({ kind: 'completed', result: 'hi' })
  }, TEST_TIMEOUT_MS)

  it('reports a thrown cell error', async () => {
    const outcome = await evaluateCell({
      program: `export default async () => { throw new Error('boom') }`,
    })
    expect(outcome.kind).toBe('error')
    if (outcome.kind === 'error') {
      expect(outcome.error).toContain('boom')
    }
  }, TEST_TIMEOUT_MS)

  it('rejects a syntactically invalid program in check mode', async () => {
    const outcome = await evaluateCell({
      program: 'export default async () => {',
      mode: 'check',
    })
    expect(outcome.kind).toBe('error')
  }, TEST_TIMEOUT_MS)

  it('passes a valid program in check mode without calling the cell', async () => {
    const outcome = await evaluateCell({
      program: `export default async () => { throw new Error('must never run in check mode') }`,
      mode: 'check',
    })
    expect(outcome).toEqual({ kind: 'check-passed' })
  }, TEST_TIMEOUT_MS)

  it('rejects a program without a default export', async () => {
    const outcome = await evaluateCell({ program: 'export const answer = 42' })
    expect(outcome.kind).toBe('error')
    if (outcome.kind === 'error') {
      expect(outcome.error).toContain('default')
    }
  }, TEST_TIMEOUT_MS)

  it('kills an infinite loop after the wall-clock timeout', async () => {
    const startedAt = Date.now()
    const outcome = await evaluateCell({
      program: `export default async () => { while (true) {} }`,
      timeoutMs: 500,
    })
    expect(outcome).toEqual({ kind: 'timeout' })
    expect(Date.now() - startedAt).toBeLessThan(10_000)
  }, TEST_TIMEOUT_MS)

  it('reports a structured-clone failure for non-cloneable results', async () => {
    // Circular references survive structured clone; function values do not.
    const program = `export default async () => ({ callback: () => {} })`
    const outcome = await evaluateCell({ program })
    expect(outcome.kind).toBe('error')
  }, TEST_TIMEOUT_MS)
})
