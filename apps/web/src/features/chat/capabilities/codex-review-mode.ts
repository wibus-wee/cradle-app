import type { GetWorkspacesByWorkspaceIdGitBranchesResponse } from '~/api-gen/types.gen'

export type CodexReviewTargetMode = 'uncommitted' | 'base-branch'

export interface CodexReviewBranchLine {
  key: string
  label: string
}

export interface BuildCodexReviewPromptInput {
  mode: CodexReviewTargetMode
  sourceBranch: string
  repositoryPath?: string | null
  baseBranch?: string
  mergeBaseSha?: string
}

const CODEX_REVIEW_GUIDELINES_HEADING = '## Code review guidelines:'
const CODEX_REVIEW_REQUEST_HEADING = '## My request for Codex:'
const DEFAULT_TARGET_BRANCH = 'main'

const CODEX_REVIEW_GUIDELINES = `# Review Guidelines

You are acting as a reviewer for a proposed code change made by another engineer.

Review the change and respond in normal Markdown. Do not return JSON, XML, a findings object, or any structured review schema.

When feedback should be attached directly to a changed line, emit one \`::code-comment{...}\` directive for that issue. The directive creates an inline code comment in the review UI; keep the visible response as normal Markdown. Emit no directives when there are no actionable inline comments.

Required \`code-comment\` attributes: \`title\`, \`body\`, and \`file\`. Optional attributes: \`start\`, \`end\`, and \`priority\`. Use the shortest useful line range. \`file\` should be an absolute path or include the workspace folder segment.

Focus on discrete, actionable issues the original author would likely fix if they knew about them. Prefer no issues over speculative or low-signal feedback.

General guidelines for whether to call out an issue:

1. It meaningfully impacts correctness, performance, security, or maintainability.
2. It is discrete and actionable.
3. It was introduced by the change under review.
4. The author would likely fix it once aware.
5. It does not rely on unstated assumptions about intent.
6. It identifies the affected behavior clearly rather than speculating broadly.

When you call out an issue, include the relevant file and line or function in prose, explain the scenario where it matters, and keep the explanation concise. Use priority labels such as \`[P1]\` or \`[P2]\` only when helpful to communicate severity.

If there are no actionable issues, say that directly and briefly.`

const UNCOMMITTED_REVIEW_INSTRUCTIONS = 'Review the current code changes (staged, unstaged, and untracked files) and provide concise, actionable feedback in a normal Markdown response.'

const BASE_BRANCH_REVIEW_INSTRUCTIONS = 'Review the code changes against the base branch \'{baseBranch}\'. The merge base commit for this comparison is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes relative to {baseBranch}. Provide concise, actionable feedback in a normal Markdown response.'

export function buildCodexReviewPrompt(input: BuildCodexReviewPromptInput): string {
  const repositoryInstructions = buildRepositoryInstructions(input.repositoryPath)
  if (input.mode === 'uncommitted') {
    return joinCodexReviewPrompt({
      reviewInstructions: joinReviewInstructions(repositoryInstructions, UNCOMMITTED_REVIEW_INSTRUCTIONS),
      requestMessage: 'Please review my uncommitted changes',
    })
  }

  if (!input.baseBranch || !input.mergeBaseSha) {
    throw new Error('Base branch review requires a base branch and merge base SHA.')
  }

  return joinCodexReviewPrompt({
    reviewInstructions: joinReviewInstructions(
      repositoryInstructions,
      BASE_BRANCH_REVIEW_INSTRUCTIONS
        .replaceAll('{baseBranch}', input.baseBranch)
        .replaceAll('{mergeBaseSha}', input.mergeBaseSha.trim()),
    ),
    requestMessage: `Please review changes on ${input.sourceBranch} against ${input.baseBranch}`,
  })
}

function buildRepositoryInstructions(repositoryPath: string | null | undefined): string | null {
  if (!repositoryPath || repositoryPath === '.') {
    return null
  }
  return `The Git repository under review is the workspace-relative directory \`${repositoryPath}\`. Run Git commands from that directory.`
}

function joinReviewInstructions(...instructions: Array<string | null>): string {
  return instructions.filter(Boolean).join('\n\n')
}

function joinCodexReviewPrompt({
  reviewInstructions,
  requestMessage,
}: {
  reviewInstructions: string
  requestMessage: string
}): string {
  return [
    CODEX_REVIEW_GUIDELINES_HEADING,
    CODEX_REVIEW_GUIDELINES.trim(),
    reviewInstructions.trim(),
    CODEX_REVIEW_REQUEST_HEADING,
    requestMessage,
  ].join('\n')
}

export function createCodexReviewBranchLines({
  branches,
  currentBranch,
}: {
  branches: GetWorkspacesByWorkspaceIdGitBranchesResponse | null | undefined
  currentBranch: string | null | undefined
}): CodexReviewBranchLine[] {
  const excluded = new Set<string>()
  if (currentBranch) {
    excluded.add(currentBranch)
  }

  const preferred = [
    DEFAULT_TARGET_BRANCH,
    'master',
    'develop',
    'origin/main',
    'origin/master',
    'origin/develop',
  ]
  const ordered = [
    ...preferred,
    ...(branches?.local ?? []).map(branch => branch.name),
    ...(branches?.remote ?? []).map(branch => branch.name),
  ]
  const seen = new Set<string>()
  const lines: CodexReviewBranchLine[] = []

  for (const branchName of ordered) {
    if (!branchName || excluded.has(branchName) || seen.has(branchName)) {
      continue
    }
    const exists = branchExists(branches, branchName)
    if (!exists && branchName !== DEFAULT_TARGET_BRANCH) {
      continue
    }
    seen.add(branchName)
    lines.push({ key: branchName, label: branchName })
  }

  return lines
}

function branchExists(
  branches: GetWorkspacesByWorkspaceIdGitBranchesResponse | null | undefined,
  branchName: string,
): boolean {
  return Boolean(
    branches?.local.some(branch => branch.name === branchName)
    || branches?.remote.some(branch => branch.name === branchName),
  )
}
