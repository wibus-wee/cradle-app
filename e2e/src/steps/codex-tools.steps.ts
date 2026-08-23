import { Given, When } from '@cucumber/cucumber'

import {
  configureCodexApprovalSimulator,
  configureCodexCommandExecutionSimulator,
  configureCodexFileChangeSimulator,
  configureCodexPlanUpdateSimulator,
} from '../support/helpers/codex-tool-scenario'
import type { CradleWorld } from '../support/world'

Given('我已配置 Codex exec_command Simulator', async function (this: CradleWorld) {
  await configureCodexCommandExecutionSimulator(this)
})

Given('我已配置 Codex update_plan Simulator', async function (this: CradleWorld) {
  await configureCodexPlanUpdateSimulator(this)
})

Given('我已配置 Codex apply_patch Simulator', async function (this: CradleWorld) {
  await configureCodexFileChangeSimulator(this)
})

Given('我已配置 Codex 审批 Simulator', async function (this: CradleWorld) {
  await configureCodexApprovalSimulator(this)
})

When('我选择需要审批的访问模式', async function (this: CradleWorld) {
  await this.newChat.selectPermissionMode(/Approval required|需要审批|Requiere aprobación|承認が必要/i)
})

When('我允许 Codex 命令审批', async function (this: CradleWorld) {
  await this.approval.waitVisible(30_000)
  await this.approval.allow()
})
