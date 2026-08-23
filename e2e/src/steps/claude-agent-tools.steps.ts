import { Given } from '@cucumber/cucumber'

import { configureToolMatrixSimulator } from '../support/helpers/stream-vocabulary-scenario'
import type { CradleWorld } from '../support/world'

Given('我已配置 Claude Agent 工具矩阵 Simulator（{string}）', async function (this: CradleWorld, scenarioKey: string) {
  await configureToolMatrixSimulator(this, scenarioKey)
})
