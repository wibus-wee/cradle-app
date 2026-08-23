import { Given } from '@cucumber/cucumber'

import {
  configureDisconnectingSimulator,
  configureParallelToolsSimulator,
  configureRedactedThinkingSimulator,
} from '../support/helpers/stream-vocabulary-scenario'
import type { CradleWorld } from '../support/world'

Given('我已配置并行工具块 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureParallelToolsSimulator(this)
})

Given('我已配置加密思考 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureRedactedThinkingSimulator(this)
})

Given('我已配置会中途断连的 Claude Agent Simulator', async function (this: CradleWorld) {
  await configureDisconnectingSimulator(this)
})
