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

Run the focused PR body checker tests.

## Performance and impact

- **Baseline/current evidence:** No runtime path; this changes static validation only.
- **Measurement scope:** PR body checker fixtures.
- **Implementation cost:** One validation rule and its fixtures.
- **Side effects/tradeoffs:** Existing PRs must fill the new fields when updated.
- **Impact radius:** All non-bot pull requests.
- **Decision:** Ship because the validation cost is small and required evidence becomes reviewable.`

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

const missingPerformanceFieldBody = validHumanBody.replace(
  '- **Implementation cost:** One validation rule and its fixtures.',
  '- **Implementation cost:** <!-- not filled -->',
)
const missingPerformanceFieldResult = checkPullRequestBody(missingPerformanceFieldBody)

assert.equal(missingPerformanceFieldResult.ok, false)
assert.ok(missingPerformanceFieldResult.findings.includes(
  '## Performance and impact must fill **Implementation cost:** with evidence or an explicit reason it is not measurable.',
))

const missingDecisionBody = validHumanBody.replace(
  '- **Decision:** Ship because the validation cost is small and required evidence becomes reviewable.',
  '- **Decision:** <!-- not filled -->',
)
const missingDecisionResult = checkPullRequestBody(missingDecisionBody)

assert.equal(missingDecisionResult.ok, false)
assert.ok(missingDecisionResult.findings.includes(
  '## Performance and impact must fill **Decision:** with evidence or an explicit reason it is not measurable.',
))

console.log('PR body checker regression tests passed')
