import assert from 'node:assert/strict'

import { checkPullRequestBody } from './check-pr-body.mjs'

const validHumanBody = `## Author type

- [ ] I am an Agent (check this if an LLM agent authored this PR)
- [x] I am a human

## Problem / pressure

PR body failures did not identify duplicated template sections.

## Summary

Reject duplicate required sections with a specific finding.

## Test plan

Run the focused PR body checker tests.`

assert.deepEqual(checkPullRequestBody(validHumanBody), {
  ok: true,
  findings: [],
  agent: false,
  human: true,
})

const duplicateSummaryBody = validHumanBody.replace(
  '## Summary\n\nReject duplicate required sections with a specific finding.',
  '## Summary\n\nFirst summary.\n\n## Summary\n\nRepeated summary.',
)
const duplicateSummaryResult = checkPullRequestBody(duplicateSummaryBody)

assert.equal(duplicateSummaryResult.ok, false)
assert.ok(duplicateSummaryResult.findings.includes(
  'Duplicate required section: ## Summary appears 2 times; each required section must appear exactly once.',
))

const duplicateAgentHandoffBody = `${validHumanBody
  .replace('- [ ] I am an Agent (check this if an LLM agent authored this PR)', '- [x] I am an Agent (check this if an LLM agent authored this PR)')
  .replace('- [x] I am a human', '- [ ] I am a human')}

## Agent handoff

<!-- agent-handoff:begin -->
### Instructions for reviewing agents

Review instructions.

### Authoring context

N/A

### Sharing consent (author side)

- [ ] Pending
<!-- agent-handoff:end -->

## Agent handoff

Repeated handoff.`
const duplicateAgentHandoffResult = checkPullRequestBody(duplicateAgentHandoffBody)

assert.equal(duplicateAgentHandoffResult.ok, false)
assert.ok(duplicateAgentHandoffResult.findings.includes(
  'Duplicate required Agent section: ## Agent handoff appears 2 times; each required Agent section must appear exactly once.',
))

console.log('PR body checker regression tests passed')
