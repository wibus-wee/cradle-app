import { Then, When } from '@cucumber/cucumber'

import type { CradleWorld } from '../support/world'

Then('MCP Servers 设置页面应显示空状态', async function (this: CradleWorld) {
  await this.mcpServersPage.expectEmpty()
})

When('我开始添加 MCP 服务器', async function (this: CradleWorld) {
  await this.mcpServersPage.startAdding()
})

When('我输入包含无效密钥行的本地 MCP 配置', async function (this: CradleWorld) {
  await this.mcpServersPage.enterInvalidLocalConfig()
})

Then('MCP 配置应拒绝无效密钥行', async function (this: CradleWorld) {
  await this.mcpServersPage.expectInvalidSecretLine()
})

When('我修正密钥并保存本地 MCP 服务器', async function (this: CradleWorld) {
  await this.mcpServersPage.correctSecretsAndCreate()
})

Then('本地 MCP 服务器应以规范化配置创建成功', async function (this: CradleWorld) {
  await this.mcpServersPage.expectLocalCreated(true)
})

Then('本地 MCP 服务器应恢复已保存的公开配置', async function (this: CradleWorld) {
  await this.mcpServersPage.expectLocalCreated(false)
})

When('我编辑本地 MCP 服务器', async function (this: CradleWorld) {
  await this.mcpServersPage.editLocalServer()
})

Then('MCP 编辑表单应隐藏密钥值并保留密钥名称', async function (this: CradleWorld) {
  await this.mcpServersPage.expectStoredSecretsHidden()
})

When('我将 MCP 服务器更新为 HTTP 传输且保留密钥', async function (this: CradleWorld) {
  await this.mcpServersPage.updateToHttp()
})

Then('HTTP MCP 服务器应显示更新成功', async function (this: CradleWorld) {
  await this.mcpServersPage.expectHttpUpdated(true)
})

Then('HTTP MCP 服务器应恢复更新后的公开配置', async function (this: CradleWorld) {
  await this.mcpServersPage.expectHttpUpdated(false)
})

When('我禁用 HTTP MCP 服务器', async function (this: CradleWorld) {
  await this.mcpServersPage.disableHttpServer()
})

Then('HTTP MCP 服务器应显示为已禁用', async function (this: CradleWorld) {
  await this.mcpServersPage.expectHttpDisabled()
})

Then('HTTP MCP 服务器应保持已禁用', async function (this: CradleWorld) {
  await this.mcpServersPage.expectHttpDisabled()
})

When('我确认删除 HTTP MCP 服务器', async function (this: CradleWorld) {
  await this.mcpServersPage.deleteHttpServer()
})

Then('MCP Servers 设置页面应显示删除成功的空状态', async function (this: CradleWorld) {
  await this.mcpServersPage.expectDeleted(true)
})

Then('MCP 服务器应保持已删除状态', async function (this: CradleWorld) {
  await this.mcpServersPage.expectDeleted(false)
})
