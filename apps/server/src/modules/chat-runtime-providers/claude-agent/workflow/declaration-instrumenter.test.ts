import { describe, expect, it } from 'vitest'

import { instrumentClaudeWorkflowScript } from './declaration-instrumenter'

describe('instrumentClaudeWorkflowScript', () => {
  it('instruments conditionals, logical expressions, loops, switches, iterables, and catches', () => {
    const result = instrumentClaudeWorkflowScript(`
export const meta = { name: 'paths' }
if (result.ok && result.ready) phase('if')
const title = result.kind ? 'yes' : 'no'
while (result.more) break
for (const item of result.items) agent(item)
switch (result.kind) {
  case 'a': phase('a'); break
  default: phase('default')
}
try { phase(title) } catch { phase('catch') }
return title
`)

    expect(result.branchCount).toBe(7)
    expect(result.code).toContain('globalThis.__declarations.meta =')
    expect(result.code).toContain('__branch("if:')
    expect(result.code).toContain('__branch("logical-&&:')
    expect(result.code).toContain('__branch("conditional:')
    expect(result.code).toContain('__iterable("for-of:')
    expect(result.code).toContain('__switchValue("switch:')
    expect(result.code).toContain('__switchCase("switch:')
    expect(result.code).toContain('workflow declaration catch path')
  })

  it('uses source offsets to produce stable output', () => {
    const source = `if (value) phase('one'); else phase('two')`
    expect(instrumentClaudeWorkflowScript(source)).toEqual(instrumentClaudeWorkflowScript(source))
  })
})
