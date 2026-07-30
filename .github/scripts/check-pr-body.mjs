#!/usr/bin/env node
/**
 * Static format check for Cradle pull request bodies.
 * Spec source: .github/PULL_REQUEST_TEMPLATE.md
 *
 * Usage:
 *   node .github/scripts/check-pr-body.mjs --body-file path.md
 *   node .github/scripts/check-pr-body.mjs --body "..."
 *   PR_BODY="..." node .github/scripts/check-pr-body.mjs
 *
 * Exit 0 on pass, 1 on fail. Prints machine-readable findings on stderr/stdout.
 */

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const REQUIRED_HEADINGS = [
  '## Author type',
  '## Problem / pressure',
  '## Summary',
  '## Test plan',
]

const AGENT_CHECKBOX = /- \[x\] I am an Agent/i
const HUMAN_CHECKBOX = /- \[x\] I am a human/i
const AGENT_HANDOFF_HEADING = '## Agent handoff'
const REVIEWING_INSTRUCTIONS = '### Instructions for reviewing agents'
const AUTHORING_CONTEXT = '### Authoring context'
const SHARING_CONSENT = '### Sharing consent (author side)'
const AGENT_HANDOFF_BEGIN = '<!-- agent-handoff:begin -->'
const AGENT_HANDOFF_END = '<!-- agent-handoff:end -->'

const PLACEHOLDER_ONLY = /^(?:<!--[\s\S]*?-->|\s|N\/?A|TODO|TBD|\(optional\))*$/i

function parseArgs(argv) {
  const out = { body: process.env.PR_BODY ?? '', bodyFile: null }
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--body-file') {
      out.bodyFile = argv[++i]
      continue
    }
    if (arg === '--body') {
      out.body = argv[++i] ?? ''
      continue
    }
    if (arg === '--help' || arg === '-h') {
      out.help = true
    }
  }
  return out
}

function sectionBody(markdown, heading) {
  const start = markdown.indexOf(heading)
  if (start === -1) {
    return null
  }
  const after = start + heading.length
  const rest = markdown.slice(after)
  const next = rest.search(/\n##\s+/)
  const chunk = (next === -1 ? rest : rest.slice(0, next)).trim()
  return chunk
}

function isFilledSection(chunk) {
  if (chunk == null) {
    return false
  }
  const withoutComments = chunk.replace(/<!--[\s\S]*?-->/g, '').trim()
  if (!withoutComments) {
    return false
  }
  return !PLACEHOLDER_ONLY.test(withoutComments)
}

export function checkPullRequestBody(body) {
  const findings = []
  const text = (body ?? '').replace(/\r\n/g, '\n')

  if (!text.trim()) {
    findings.push('PR body is empty. Fill `.github/PULL_REQUEST_TEMPLATE.md`.')
    return { ok: false, findings, agent: false, human: false }
  }

  for (const heading of REQUIRED_HEADINGS) {
    if (!text.includes(heading)) {
      findings.push(`Missing required heading: ${heading}`)
    }
  }

  const agent = AGENT_CHECKBOX.test(text)
  const human = HUMAN_CHECKBOX.test(text)

  if (!agent && !human) {
    findings.push(
      'Author type: check exactly one of "I am an Agent" or "I am a human" (`- [x] ...`).',
    )
  }
  if (agent && human) {
    findings.push('Author type: check only one of Agent or human, not both.')
  }

  if (!isFilledSection(sectionBody(text, '## Problem / pressure'))) {
    findings.push(
      '## Problem / pressure must state the constraint/failure this PR responds to (not only HTML comments / placeholders). Review against pressure, not aesthetics.',
    )
  }
  if (!isFilledSection(sectionBody(text, '## Summary'))) {
    findings.push('## Summary must include a non-empty description (not only HTML comments / placeholders).')
  }
  if (!isFilledSection(sectionBody(text, '## Test plan'))) {
    findings.push('## Test plan must include concrete verification (not only HTML comments / placeholders).')
  }

  if (agent) {
    if (!text.includes(AGENT_HANDOFF_HEADING)) {
      findings.push('Agent PRs must include ## Agent handoff.')
    }
    if (!text.includes(AGENT_HANDOFF_BEGIN) || !text.includes(AGENT_HANDOFF_END)) {
      findings.push('Agent PRs must keep <!-- agent-handoff:begin/end --> markers.')
    }
    if (!text.includes(REVIEWING_INSTRUCTIONS)) {
      findings.push('Agent PRs must include ### Instructions for reviewing agents.')
    }
    if (!text.includes(AUTHORING_CONTEXT)) {
      findings.push('Agent PRs must include ### Authoring context.')
    }
    if (!text.includes(SHARING_CONSENT)) {
      findings.push('Agent PRs must include ### Sharing consent (author side).')
    }
  }

  return { ok: findings.length === 0, findings, agent, human }
}

function main() {
  const args = parseArgs(process.argv)
  if (args.help) {
    console.log('Usage: node .github/scripts/check-pr-body.mjs [--body-file path | --body text]')
    process.exit(0)
  }

  let body = args.body
  if (args.bodyFile) {
    body = readFileSync(args.bodyFile, 'utf8')
  }

  const result = checkPullRequestBody(body)
  if (result.ok) {
    console.log(`PR body format OK${
       result.agent ? ' (agent)' : ''
       }${result.human ? ' (human)' : ''}`)
    process.exit(0)
  }

  console.error('PR body does not match Cradle pull request template:\n')
  for (const finding of result.findings) {
    console.error(`- ${finding}`)
  }
  console.error('\nSee `.github/PULL_REQUEST_TEMPLATE.md`.')
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
