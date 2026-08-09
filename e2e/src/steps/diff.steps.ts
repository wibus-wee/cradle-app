import { execFileSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

interface GitWorkspaceFixture {
  dir: string
}

const FIXTURE_KEY = 'git.workspace-fixture'

function fixture(world: CradleWorld): GitWorkspaceFixture {
  return world.recall<GitWorkspaceFixture>(FIXTURE_KEY)
}

Given('真实 Git 工作区中存在未提交文件{string}，内容为{string}', function (
  this: CradleWorld,
  path: string,
  content: string,
) {
  writeFileSync(join(fixture(this).dir, path), `${content}\n`, 'utf8')
  this.remember('diff.dirty-file', path)
})

When('我打开 Diffs', async function (this: CradleWorld) {
  await this.diffPage.openFromNav()
})

When('我打开 Working tree', async function (this: CradleWorld) {
  await this.diffPage.openWorkingTree()
})

Then('Working tree 应显示未提交文件{string}', async function (this: CradleWorld, path: string) {
  await this.diffPage.expectFile(path)
})

Then('Working tree diff 应包含{string}', async function (this: CradleWorld, content: string) {
  await this.diffPage.expectContent(content)
})

When('外部进程把{string}追加到未提交文件{string}', function (this: CradleWorld, content: string, path: string) {
  appendFileSync(join(fixture(this).dir, path), `${content}\n`, 'utf8')
})

When('我刷新 Working tree review', async function (this: CradleWorld) {
  await this.diffPage.refresh()
})

Then('真实 Git 仓库仍应保留该未提交变更', function (this: CradleWorld) {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: fixture(this).dir, encoding: 'utf8' })
  expect(status).toContain(this.recall<string>('diff.dirty-file'))
})
