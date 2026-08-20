import { expect } from '@playwright/test'

import { configureTitleGenerationSink } from '../providers'
import { anthropicScenario, anthropicTextExchange } from '../scenarios/anthropic'
import type { CradleWorld } from '../world'

const PROVIDER_DISABLE_GATES = ['e2e-provider-disable-queued', 'e2e-provider-disable-active'] as const

export async function configureProviderDisableGatedSimulator(world: CradleWorld): Promise<void> {
  const simulator = await world.ensureSimulator()
  simulator.reset()
  await configureTitleGenerationSink(world.params.serverUrl)
  world.enqueue(anthropicScenario([
    anthropicTextExchange({
      label: 'provider-disable-queued-session',
      text: 'Provider 禁用前不应完成的排队会话回复',
      gateAfterStart: PROVIDER_DISABLE_GATES[0],
      bodyTextIncludes: 'Provider 禁用排队会话主任务',
      bodyTextExcludes: 'You are naming a Claude Agent task session',
    }),
    anthropicTextExchange({
      label: 'provider-disable-active-session',
      text: 'Provider 禁用前不应完成的活跃会话回复',
      gateAfterStart: PROVIDER_DISABLE_GATES[1],
      bodyTextIncludes: 'Provider 禁用活跃会话主任务',
      bodyTextExcludes: 'You are naming a Claude Agent task session',
    }),
  ]))
}

export function expectProviderDisableGatesCanceled(world: CradleWorld): void {
  const simulator = world.simulator
  if (!simulator) {
    throw new Error('Expected simulator to be configured')
  }
  for (const gate of PROVIDER_DISABLE_GATES) {
    expect(() => simulator.release(gate)).toThrow(`Unknown or already settled gate "${gate}"`)
  }
}
