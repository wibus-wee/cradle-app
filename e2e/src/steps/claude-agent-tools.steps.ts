import { Given, Then, When } from '@cucumber/cucumber'

import {
  configureArtifactLifecycleSimulator,
  configureToolMatrixSimulator,
} from '../support/helpers/stream-vocabulary-scenario'
import type { CradleWorld } from '../support/world'

Given('我已配置 Claude Agent 工具矩阵 Simulator（{string}）', async function (this: CradleWorld, scenarioKey: string) {
  await configureToolMatrixSimulator(this, scenarioKey)
})

Given('我已配置 Claude Agent Artifact 生命周期 Simulator', async function (this: CradleWorld) {
  await configureArtifactLifecycleSimulator(this)
})

Then('聊天应显示 Artifact {string}（ID {string}）的 revision {int}', async function (
  this: CradleWorld,
  title: string,
  artifactId: string,
  revision: number,
) {
  await this.chat.expectArtifactPreview(title, artifactId, revision)
})

When('我打开 Artifact {string} 的 revision {int}', async function (
  this: CradleWorld,
  title: string,
  revision: number,
) {
  await this.chat.openArtifact(title, revision)
})

Then('Artifact 面板应显示标题 {string}、ID {string}、revision {int} 与内容 {string}', async function (
  this: CradleWorld,
  title: string,
  artifactId: string,
  revision: number,
  content: string,
) {
  await this.chat.expectArtifactPanel({ title, artifactId, revision, content })
})

Then('Artifact 面板不应显示旧内容 {string}', async function (this: CradleWorld, content: string) {
  await this.chat.expectArtifactPanelExcludes(content)
})
