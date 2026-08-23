import {
  anthropicDisconnectAfterStartExchange,
  anthropicRedactedThinkingTextExchange,
  anthropicScenario,
  anthropicTextExchange,
} from '../scenarios/anthropic'
import { claudeAgentParallelToolsExchanges, claudeAgentToolLoopExchanges, toolMatrixEntry } from '../scenarios/tool-matrix'
import type { CradleWorld } from '../world'

const EXCLUDE_TITLE = 'You are naming a Claude Agent task session'

function requireSimulator(world: CradleWorld) {
  if (!world.simulator) {
    throw new Error('Expected simulator to be configured')
  }
  return world.simulator
}

/**
 * `redacted_thinking` block followed by a normal text block: the opaque payload must
 * not break projection and the visible answer must still land.
 */
export async function configureRedactedThinkingSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure redacted-thinking Claude Agent simulator')
  await world.configureClaudeAgentChat()
  requireSimulator(world).reset()
  world.enqueue(anthropicScenario([
    anthropicRedactedThinkingTextExchange({
      label: 'redacted-thinking',
      text: '已跳过加密思考并完成回复',
      bodyTextIncludes: '请处理加密思考',
      bodyTextExcludes: EXCLUDE_TITLE,
    }),
  ]))
}

/** Mid-stream SSE disconnect, then a successful retry turn. */
export async function configureDisconnectingSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure disconnecting Claude Agent simulator')
  await world.configureClaudeAgentChat()
  requireSimulator(world).reset()
  world.enqueue(anthropicScenario([
    anthropicDisconnectAfterStartExchange({
      label: 'mid-stream-disconnect',
      partialText: '回复刚开始就中断',
      bodyTextIncludes: '请触发连接中断',
      bodyTextExcludes: EXCLUDE_TITLE,
    }),
    anthropicTextExchange({
      label: 'after-disconnect-recovery',
      text: '中断后新一轮成功完成',
      bodyTextIncludes: '中断后重新发送',
      bodyTextExcludes: EXCLUDE_TITLE,
    }),
  ]))
}

/** Parallel tool_use blocks with an incrementally-streamed second input. */
export async function configureParallelToolsSimulator(world: CradleWorld): Promise<void> {
  console.warn('[step] configure parallel tool-use Claude Agent simulator')
  await world.configureClaudeAgentChat()
  requireSimulator(world).reset()
  for (const exchange of claudeAgentParallelToolsExchanges()) {
    world.enqueue(anthropicScenario([exchange]))
  }
}

/** One scripted tool loop for a single tool-matrix entry, keyed by its stable key. */
export async function configureToolMatrixSimulator(world: CradleWorld, key: string): Promise<void> {
  console.warn(`[step] configure Claude Agent tool matrix simulator (${key})`)
  await world.configureClaudeAgentChat()
  requireSimulator(world).reset()
  for (const exchange of claudeAgentToolLoopExchanges(toolMatrixEntry(key))) {
    world.enqueue(anthropicScenario([exchange]))
  }
}
