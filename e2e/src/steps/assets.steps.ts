import { join } from 'node:path'

import { Then, When } from '@cucumber/cucumber'

import type { CradleWorld } from '../support/world'

const SAMPLE_IMAGE_PATH = join(
  process.cwd(),
  'apps/web/src/components/common/assets/hijarvis.png',
)
const SAMPLE_IMAGE_NAME = 'hijarvis.png'

When('我在当前 Issue 描述中上传示例图片', async function (this: CradleWorld) {
  await this.kanbanPage.uploadIssueDescriptionImage(SAMPLE_IMAGE_PATH, SAMPLE_IMAGE_NAME)
})

Then('当前 Issue 描述应显示已保存的示例图片', async function (this: CradleWorld) {
  await this.kanbanPage.expectSavedIssueDescriptionImage(SAMPLE_IMAGE_NAME)
})

Then('当前 Issue 描述应继续显示同一张示例图片', async function (this: CradleWorld) {
  await this.kanbanPage.expectPersistedIssueDescriptionImage(SAMPLE_IMAGE_NAME)
})
