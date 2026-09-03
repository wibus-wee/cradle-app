import { Then, When } from '@cucumber/cucumber'

import type { DelayedNotesSave } from '../support/pages/session-environment'
import type { CradleWorld } from '../support/world'

const NOTES_SAVE_GATE = 'session-environment.notes-save-gate'

When('我打开会话 Environment 面板', async function (this: CradleWorld) {
  await this.sessionEnvironmentPage.open()
})

When('我让下一次备注保存请求等待', async function (this: CradleWorld) {
  this.remember(NOTES_SAVE_GATE, await this.sessionEnvironmentPage.delayNextNotesSave())
})

When('我输入会话备注{string}', async function (this: CradleWorld, notes: string) {
  await this.sessionEnvironmentPage.fillNotes(notes)
})

Then('第一版会话备注保存请求应已开始', async function (this: CradleWorld) {
  await this.recall<DelayedNotesSave>(NOTES_SAVE_GATE).waitUntilBlocked()
})

When('我继续输入会话备注{string}', async function (this: CradleWorld, notes: string) {
  await this.sessionEnvironmentPage.fillNotes(notes)
})

When('我释放第一版会话备注保存请求', async function (this: CradleWorld) {
  this.recall<DelayedNotesSave>(NOTES_SAVE_GATE).release()
})

Then('较旧保存完成后备注草稿仍应为{string}', async function (this: CradleWorld, notes: string) {
  const gate = this.recall<DelayedNotesSave>(NOTES_SAVE_GATE)
  await gate.waitUntilCompleted()
  await this.sessionEnvironmentPage.expectDraft(notes)
})

Then('会话备注最终应保存成功', async function (this: CradleWorld) {
  await this.sessionEnvironmentPage.expectStatus('saved')
  await this.recall<DelayedNotesSave>(NOTES_SAVE_GATE).dispose()
})

Then('会话备注应为{string}', async function (this: CradleWorld, notes: string) {
  await this.sessionEnvironmentPage.expectDraft(notes)
})

Then('会话备注应显示已保存', async function (this: CradleWorld) {
  await this.sessionEnvironmentPage.expectStatus('saved')
})
