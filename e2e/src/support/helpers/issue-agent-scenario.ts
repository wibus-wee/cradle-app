import { anthropicScenario, anthropicTextExchange, anthropicToolUseExchange } from '../scenarios/anthropic'
import type { CradleWorld } from '../world'

export const ISSUE_AGENT_FIRST_RESPONSE = 'Issue 委派第一轮已完成'
export const ISSUE_AGENT_RERUN_RESPONSE = 'Issue 委派重跑已完成'
export const ISSUE_AGENT_SLOW_RESPONSE = '这段被取消的委派回复不应完整出现'
export const ISSUE_AGENT_WORK_RESPONSE = 'Issue 隔离 Work 已完成'
export const ISSUE_AGENT_WORK_FILE = 'e2e-issue-work-result.txt'
export const ISSUE_AGENT_WORK_CONTENT = 'created by an isolated Issue delegation\n'

const ISSUE_AGENT_GATE = 'issue-agent-slow-gate'
const ISSUE_AGENT_RERUN_GATE = 'issue-agent-rerun-gate'
const TITLE_GENERATION_MARKER = 'You are naming a Claude Agent task session'

function issuePromptTitle(title: string): string {
  return `# Cradle Issue: ${title}`
}

export async function configureCompletedIssueDelegation(
  world: CradleWorld,
  issueTitle: string,
): Promise<void> {
  await world.configureClaudeAgentChat({ mode: 'text' })
  const simulator = await world.ensureSimulator()
  simulator.reset()
  world.enqueue(anthropicScenario([
    anthropicTextExchange({
      label: 'issue-delegation-first-run',
      text: ISSUE_AGENT_FIRST_RESPONSE,
      bodyTextIncludes: issuePromptTitle(issueTitle),
      bodyTextExcludes: TITLE_GENERATION_MARKER,
    }),
  ]))
  world.remember('issue-agent.rerun-title', issueTitle)
}

export function enqueueIssueAgentRerunResponse(world: CradleWorld): void {
  const issueTitle = world.recall<string>('issue-agent.rerun-title')
  world.enqueue(anthropicScenario([
    anthropicTextExchange({
      label: 'issue-delegation-rerun',
      text: ISSUE_AGENT_RERUN_RESPONSE,
      gateAfterStart: ISSUE_AGENT_RERUN_GATE,
      bodyTextIncludes: issuePromptTitle(issueTitle),
      bodyTextExcludes: TITLE_GENERATION_MARKER,
    }),
  ]))
}

export async function releaseIssueAgentRerun(world: CradleWorld): Promise<void> {
  const simulator = await world.ensureSimulator()
  await simulator.waitForGate(ISSUE_AGENT_RERUN_GATE)
  simulator.release(ISSUE_AGENT_RERUN_GATE)
}

export async function configureCancelableIssueDelegation(
  world: CradleWorld,
  issueTitle: string,
): Promise<void> {
  await world.configureClaudeAgentChat({ mode: 'text' })
  const simulator = await world.ensureSimulator()
  simulator.reset()
  world.enqueue(anthropicScenario([
    anthropicTextExchange({
      label: 'issue-delegation-cancelled-run',
      text: ISSUE_AGENT_SLOW_RESPONSE,
      gateAfterStart: ISSUE_AGENT_GATE,
      bodyTextIncludes: issuePromptTitle(issueTitle),
      bodyTextExcludes: TITLE_GENERATION_MARKER,
    }),
  ]))
}

export async function configureIsolatedIssueDelegation(
  world: CradleWorld,
  issueTitle: string,
): Promise<void> {
  await world.configureClaudeAgentChat({ mode: 'text' })
  const simulator = await world.ensureSimulator()
  simulator.reset()
  const toolUseId = 'toolu_e2e_issue_work_write'
  world.enqueue(anthropicScenario([
    anthropicToolUseExchange({
      label: 'issue-isolated-work-write',
      toolUseId,
      toolName: 'Bash',
      toolInput: {
        command: `printf '%s\\n' 'created by an isolated Issue delegation' > "$CRADLE_WORKSPACE_PATH/${ISSUE_AGENT_WORK_FILE}"`,
        description: 'Write the Issue delegation result into the managed Work workspace',
      },
      bodyTextIncludes: issuePromptTitle(issueTitle),
      bodyTextExcludes: TITLE_GENERATION_MARKER,
    }),
    anthropicTextExchange({
      label: 'issue-isolated-work-final',
      text: ISSUE_AGENT_WORK_RESPONSE,
      bodyTextIncludes: toolUseId,
      bodyTextExcludes: TITLE_GENERATION_MARKER,
    }),
  ]))
}
