import { expect } from '@playwright/test'

import { anthropicScenario, anthropicTextExchange } from '../scenarios/anthropic'
import type { CradleWorld } from '../world'

export const AUTOMATION_CANCELLED_REPLY = '这段被取消的 Automation 回复不应完整出现。'
export const AUTOMATION_CANCELLED_SESSION_TITLE = '已取消的工作区审阅'

const AUTOMATION_CANCEL_GATE = 'automation-cancel-gate'
const AUTOMATION_PROMPT_MARKER = '审阅当前工作区并生成一份简短报告。'
const TITLE_GENERATION_MARKER = 'You are naming a Claude Agent task session'

export async function configureCancelableAutomationSimulator(world: CradleWorld): Promise<void> {
  await world.configureClaudeAgentChat({ mode: 'text' })
  const simulator = await world.ensureSimulator()
  simulator.reset()
  world.enqueue(anthropicScenario([
    anthropicTextExchange({
      label: 'automation-cancelled-run',
      text: AUTOMATION_CANCELLED_REPLY,
      gateAfterStart: AUTOMATION_CANCEL_GATE,
      bodyTextIncludes: AUTOMATION_PROMPT_MARKER,
      bodyTextExcludes: TITLE_GENERATION_MARKER,
    }),
    anthropicTextExchange({
      label: 'automation-cancelled-session-title',
      text: AUTOMATION_CANCELLED_SESSION_TITLE,
      bodyTextIncludes: TITLE_GENERATION_MARKER,
    }),
  ]))
}

export async function waitForCancelableAutomationGate(world: CradleWorld): Promise<void> {
  const simulator = await world.ensureSimulator()
  await simulator.waitForGate(AUTOMATION_CANCEL_GATE)
}

export async function expectCancelableAutomationGateCanceled(world: CradleWorld): Promise<void> {
  const simulator = await world.ensureSimulator()
  expect(() => simulator.release(AUTOMATION_CANCEL_GATE))
    .toThrow(`Unknown or already settled gate "${AUTOMATION_CANCEL_GATE}"`)
}
