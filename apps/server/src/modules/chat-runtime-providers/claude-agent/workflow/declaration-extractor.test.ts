import { describe, expect, it } from 'vitest'

import { extractClaudeWorkflowDeclaration } from './declaration-extractor'
import { projectClaudeWorkflowInput } from './execution'

describe('extractClaudeWorkflowDeclaration', () => {
  it('explores finite conditional, logical, switch, catch, and loop paths', async () => {
    const declaration = await extractClaudeWorkflowDeclaration(projectClaudeWorkflowInput({
      script: `
export const meta = {
  name: 'branching',
  description: 'Explore paths',
  phases: [{ title: 'Start' }],
}
phase('Start')
const result = await agent('seed', { label: 'seed' })
if (result.approved && result.ready) {
  phase('Approved')
  await agent('approved', { label: 'approved' })
} else {
  phase('Rejected')
  await agent('rejected', { label: 'rejected' })
}
const choice = result.kind === 'a' ? 'A' : 'B'
switch (choice) {
  case 'A': await agent('case-a', { label: 'case-a' }); break
  case 'B': await agent('case-b', { label: 'case-b' }); break
  default: await agent('case-default', { label: 'case-default' })
}
for (const item of result.items) await agent(String(item), { label: 'loop-agent' })
try {
  await agent('try-agent', { label: 'try-agent' })
} catch {
  await agent('catch-agent', { label: 'catch-agent' })
}
return choice
`,
    }))

    expect(declaration).not.toBeNull()
    expect(declaration?.incomplete).toBe(false)
    expect(declaration?.branchCount).toBeGreaterThanOrEqual(6)
    expect(declaration?.exploredPathCount).toBeGreaterThan(2)
    expect(declaration?.phases.map(phase => phase.title)).toEqual(expect.arrayContaining([
      'Start',
'Approved',
'Rejected',
    ]))
    expect(declaration?.agents.map(agent => agent.label)).toEqual(expect.arrayContaining([
      'seed',
'approved',
'rejected',
'case-a',
'case-b',
'case-default',
'loop-agent',
'try-agent',
'catch-agent',
    ]))
  })

  it('extracts the representative parallel Workflow shape', async () => {
    const declaration = await extractClaudeWorkflowDeclaration(projectClaudeWorkflowInput({
      script: `
export const meta = { name: 'review', phases: [{ title: 'Review' }, { title: 'Synthesize' }] }
const dimensions = [{ label: 'one', prompt: 'first' }, { label: 'two', prompt: 'second' }]
phase('Review')
const results = await parallel(dimensions.map(item => () => agent(item.prompt, { label: item.label, phase: 'Review' })))
phase('Synthesize')
await agent(\`summary: \${results.join(',')}\`, { label: 'summary', phase: 'Synthesize' })
return results
`,
    }))

    expect(declaration).toMatchObject({ name: 'review', incomplete: false })
    expect(declaration?.phases.map(phase => phase.title)).toEqual(['Review', 'Synthesize'])
    expect(declaration?.agents.map(agent => agent.label)).toEqual(['one', 'two', 'summary'])
  })

  it('marks path-limited exploration incomplete instead of claiming exhaustiveness', async () => {
    const decisions = Array.from({ length: 9 }, (_value, index) => `
if (args.branch${index}) await agent('yes-${index}', { label: 'yes-${index}' })
else await agent('no-${index}', { label: 'no-${index}' })
`).join('\n')
    const declaration = await extractClaudeWorkflowDeclaration(projectClaudeWorkflowInput({
      script: `export const meta = { name: 'path-limit' }\n${decisions}`,
    }))

    expect(declaration).not.toBeNull()
    expect(declaration?.exploredPathCount).toBe(256)
    expect(declaration?.incomplete).toBe(true)
  })

  it('contains non-terminating user code inside the worker and reports an incomplete declaration', async () => {
    const declaration = await extractClaudeWorkflowDeclaration(projectClaudeWorkflowInput({
      script: `
export const meta = { name: 'recursive' }
phase('Before recursion')
function recurse() { recurse() }
recurse()
`,
    }))

    expect(declaration).toMatchObject({
      name: 'recursive',
      incomplete: true,
      phases: [{ index: 1, title: 'Before recursion', detail: null }],
    })
  })
})
