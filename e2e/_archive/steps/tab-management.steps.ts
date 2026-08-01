import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../support/world'

const TAB_BAR = '[data-testid="surface-bar"]'
const TAB_PILL = '[data-testid^="surface-pill-"]'
const TAB_NEW_BUTTON = '[data-testid="surface-new-btn"]'
const TAB_CLOSE_BUTTON = '[data-testid^="surface-close-"]'
const TAB_ACTIVE_ATTR = 'data-surface-active'
const TAB_PILL_TEST_ID_PREFIX = 'surface-pill-'
const E2E_PROVIDER_TARGET_ID = 'e2e-tab-provider-target'
const ADDITIONAL_SURFACE_OPENERS = [
  TAB_NEW_BUTTON,
  '[data-testid="nav-automation"]',
  '[data-testid="nav-usage"]',
  '[data-testid="settings-btn"]',
] as const

interface CreatedSession {
  id: string
  title: string | null
}

async function waitForTabBar(world: CradleWorld) {
  await expect(world.page.locator(TAB_BAR)).toBeVisible({ timeout: 15_000 })
}

async function getTabCount(world: CradleWorld): Promise<number> {
  return world.page.locator(TAB_PILL).count()
}

async function waitForTabCount(world: CradleWorld, count: number, timeout = 10_000): Promise<void> {
  await expect(world.page.locator(TAB_PILL)).toHaveCount(count, { timeout })
}

async function ensureMinimumTabCount(world: CradleWorld, minCount: number): Promise<void> {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    const currentCount = await getTabCount(world)
    if (currentCount >= minCount) {
      return
    }

    await openAdditionalSurface(world)
    await world.page.waitForTimeout(150)
  }

  throw new Error(`Expected at least ${minCount} tabs before continuing`)
}

async function openAdditionalSurface(world: CradleWorld): Promise<void> {
  const before = await getTabCount(world)

  for (const selector of ADDITIONAL_SURFACE_OPENERS) {
    const button = world.page.locator(selector).first()
    if (await button.count() === 0) {
      continue
    }

    await expect(button).toBeVisible({ timeout: 10_000 })
    await button.click()

    try {
      await waitForTabCount(world, before + 1, 2_000)
      return
    }
    catch {
      // Some openers activate an existing singleton surface. Try the next distinct route.
    }
  }

  throw new Error(`Unable to open an additional surface from ${before} tabs`)
}

async function openNewTab(world: CradleWorld): Promise<void> {
  const before = await getTabCount(world)
  const button = world.page.locator(TAB_NEW_BUTTON)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
  await waitForTabCount(world, before + 1)
}

async function readTabSnapshots(world: CradleWorld) {
  return world.page.locator(TAB_PILL).evaluateAll((elements) => {
    return elements.map((element, index) => ({
      index,
      testId: element.getAttribute('data-testid') ?? '',
      active: element.getAttribute('data-surface-active') === 'true',
      title: element.getAttribute('title'),
    }))
  })
}

async function closeTabAtIndex(world: CradleWorld, index: number): Promise<void> {
  const before = await getTabCount(world)
  const tab = world.page.locator(TAB_PILL).nth(index)
  await expect(tab).toBeVisible({ timeout: 10_000 })
  await tab.hover()

  const closeButton = tab.locator(TAB_CLOSE_BUTTON)
  await expect(closeButton).toBeVisible({ timeout: 10_000 })
  await closeButton.click()
  await waitForTabCount(world, before - 1)
}

async function readActiveTab(world: CradleWorld) {
  const activeTab = world.page.locator(`${TAB_PILL}[${TAB_ACTIVE_ATTR}="true"]`).first()
  await expect(activeTab).toBeVisible({ timeout: 10_000 })
  const testId = await activeTab.getAttribute('data-testid')
  if (!testId?.startsWith(TAB_PILL_TEST_ID_PREFIX)) {
    throw new Error('Active surface pill is missing its data-testid')
  }
  return {
    id: testId.slice(TAB_PILL_TEST_ID_PREFIX.length),
    testId,
    title: await activeTab.getAttribute('title'),
  }
}

async function pressCloseActiveTabShortcut(world: CradleWorld): Promise<void> {
  await world.page.keyboard.down('Meta')
  try {
    await world.page.keyboard.press('KeyW')
  }
  finally {
    await world.page.keyboard.up('Meta')
  }
}

async function ensureTabE2EProviderTarget(world: CradleWorld): Promise<void> {
  const response = await fetch(`${world.params.serverUrl}/provider-targets/${E2E_PROVIDER_TARGET_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'E2E Tab Provider',
      providerKind: 'openai-compatible',
      enabled: true,
      connectionConfig: {
        baseUrl: 'http://127.0.0.1:1',
        model: 'mock-model',
        apiMode: 'responses',
      },
      credentialRef: null,
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to create E2E provider target: ${response.status} ${await response.text()}`)
  }
}

async function createChatSession(world: CradleWorld, title: string): Promise<CreatedSession> {
  const response = await fetch(`${world.params.serverUrl}/sessions/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      providerTargetId: E2E_PROVIDER_TARGET_ID,
      runtimeKind: 'standard',
      modelId: 'mock-model',
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to create chat session: ${response.status} ${await response.text()}`)
  }

  const session = await response.json() as CreatedSession
  if (!session.id) {
    throw new Error('Created chat session did not include an id')
  }
  return session
}

async function openChatSessionFromSidebar(world: CradleWorld, session: CreatedSession): Promise<void> {
  const sessionOpenButton = world.page.locator(`[data-testid="session-open-${session.id}"]`)
  await expect(sessionOpenButton).toBeVisible({ timeout: 20_000 })
  await sessionOpenButton.click()

  const visibleFrame = world.page.locator(`[data-chat-session-frame="${session.id}"][data-chat-session-visible="true"]`)
  await expect(visibleFrame.locator('[data-testid="chat-view"]')).toHaveAttribute('data-chat-session-id', session.id, { timeout: 20_000 })
  await expect(world.page.locator(`[data-testid="surface-pill-chat:${session.id}"]`)).toBeVisible({ timeout: 10_000 })
}

Then('标签栏应该可见', async function (this: CradleWorld) {
  await waitForTabBar(this)
})

Then('至少有一个标签页存在', async function (this: CradleWorld) {
  await waitForTabBar(this)
  expect(await getTabCount(this)).toBeGreaterThanOrEqual(1)
})

Given('我已打开两个标签页', async function (this: CradleWorld) {
  await waitForTabBar(this)
  await ensureMinimumTabCount(this, 2)
  expect(await getTabCount(this)).toBeGreaterThanOrEqual(2)
})

Given('我已打开三个标签页', async function (this: CradleWorld) {
  await waitForTabBar(this)
  while (await getTabCount(this) < 3) {
    await openAdditionalSurface(this)
  }
  expect(await getTabCount(this)).toBeGreaterThanOrEqual(3)
})

Given('我已创建并打开三个聊天会话标签页', async function (this: CradleWorld) {
  await ensureTabE2EProviderTarget(this)

  const sessions = [
    await createChatSession(this, '多标签聊天会话一'),
    await createChatSession(this, '多标签聊天会话二'),
    await createChatSession(this, '多标签聊天会话三'),
  ]

  await this.page.reload({ waitUntil: 'domcontentloaded' })

  for (const session of sessions) {
    await openChatSessionFromSidebar(this, session)
  }

  for (const session of sessions) {
    await expect(this.page.locator(`[data-testid="surface-pill-chat:${session.id}"]`)).toBeVisible({ timeout: 10_000 })
  }
  await expect(this.page.locator(`[data-testid="surface-pill-chat:${sessions.at(-1)!.id}"]`)).toHaveAttribute(TAB_ACTIVE_ATTR, 'true', { timeout: 10_000 })
  this.remember('createdChatSessions', sessions)
})

Given('第三个标签页处于活跃状态', async function (this: CradleWorld) {
  await expect(this.page.locator(TAB_PILL).nth(2)).toHaveAttribute(TAB_ACTIVE_ATTR, 'true', { timeout: 10_000 })
})

Given('只有一个标签页', async function (this: CradleWorld) {
  await waitForTabBar(this)
  while (await getTabCount(this) > 1) {
    await closeTabAtIndex(this, (await getTabCount(this)) - 1)
  }
  await waitForTabCount(this, 1)
})

When('我点击第一个标签页', async function (this: CradleWorld) {
  const firstTab = this.page.locator(TAB_PILL).first()
  await expect(firstTab).toBeVisible({ timeout: 10_000 })
  await firstTab.click()
  await expect(firstTab).toHaveAttribute(TAB_ACTIVE_ATTR, 'true', { timeout: 10_000 })
})

Then('第一个标签页应处于活跃状态', async function (this: CradleWorld) {
  await expect(this.page.locator(TAB_PILL).first()).toHaveAttribute(TAB_ACTIVE_ATTR, 'true', { timeout: 10_000 })
})

When('我关闭第二个标签页', async function (this: CradleWorld) {
  await ensureMinimumTabCount(this, 2)
  const before = await getTabCount(this)
  this.remember('tabCountBeforeClose', before)
  await closeTabAtIndex(this, 1)
})

Then('标签页总数应减少一个', async function (this: CradleWorld) {
  const before = this.recall<number>('tabCountBeforeClose')
  await waitForTabCount(this, before - 1)
})

Then('该标签页不应显示关闭按钮', async function (this: CradleWorld) {
  const firstTab = this.page.locator(TAB_PILL).first()
  await expect(firstTab).toBeVisible({ timeout: 10_000 })
  await firstTab.hover()
  await expect(firstTab.locator(TAB_CLOSE_BUTTON)).toHaveCount(0)
})

When('我关闭第三个标签页', async function (this: CradleWorld) {
  await closeTabAtIndex(this, 2)
})

Then('第二个标签页应处于活跃状态', async function (this: CradleWorld) {
  await expect(this.page.locator(TAB_PILL).nth(1)).toHaveAttribute(TAB_ACTIVE_ATTR, 'true', { timeout: 10_000 })
})

When('我点击新建标签按钮', async function (this: CradleWorld) {
  await waitForTabBar(this)
  const before = await getTabCount(this)
  this.remember('tabCountBeforeCreate', before)
  await openNewTab(this)
})

Then('标签页总数应增加一个', async function (this: CradleWorld) {
  const before = this.recall<number>('tabCountBeforeCreate')
  await waitForTabCount(this, before + 1)
})

Then('新创建的标签页应处于活跃状态', async function (this: CradleWorld) {
  const tabs = this.page.locator(TAB_PILL)
  const lastIndex = (await tabs.count()) - 1
  await expect(tabs.nth(lastIndex)).toHaveAttribute(TAB_ACTIVE_ATTR, 'true', { timeout: 10_000 })
})

When('我切换到第二个标签页', async function (this: CradleWorld) {
  await ensureMinimumTabCount(this, 2)
  const secondTab = this.page.locator(TAB_PILL).nth(1)
  await expect(secondTab).toBeVisible({ timeout: 10_000 })
  await secondTab.click()
  await expect(secondTab).toHaveAttribute(TAB_ACTIVE_ATTR, 'true', { timeout: 10_000 })
})

When('我切换回第一个标签页', async function (this: CradleWorld) {
  const firstTab = this.page.locator(TAB_PILL).first()
  await expect(firstTab).toBeVisible({ timeout: 10_000 })
  await firstTab.click()
  await expect(firstTab).toHaveAttribute(TAB_ACTIVE_ATTR, 'true', { timeout: 10_000 })
})

Then('第一个标签页的内容应完整保留', async function (this: CradleWorld) {
  const firstTab = this.page.locator(TAB_PILL).first()
  await expect(firstTab).toHaveAttribute(TAB_ACTIVE_ATTR, 'true', { timeout: 10_000 })
  await expect(this.page.locator('[data-testid="home-dashboard"]')).toBeVisible({ timeout: 10_000 })
})

Given('当前活跃标签页已被记录', async function (this: CradleWorld) {
  this.remember('activeTabBeforeShortcutClose', await readActiveTab(this))
  this.remember('tabCountBeforeClose', await getTabCount(this))
})

Given('当前活跃聊天会话标签及其左侧标签已被记录', async function (this: CradleWorld) {
  await waitForTabBar(this)

  const tabs = await readTabSnapshots(this)
  const activeIndex = tabs.findIndex(tab => tab.active)
  if (activeIndex < 0) {
    throw new Error('Expected one active surface pill before closing')
  }

  const activeTab = tabs[activeIndex]
  if (!activeTab?.testId.startsWith(`${TAB_PILL_TEST_ID_PREFIX}chat:`)) {
    throw new Error(`Expected active surface to be a chat session, got ${activeTab?.testId ?? '(missing)'}`)
  }

  const previousTab = tabs[activeIndex - 1]
  if (!previousTab?.testId.startsWith(`${TAB_PILL_TEST_ID_PREFIX}chat:`)) {
    throw new Error(`Expected the left adjacent surface to be a chat session, got ${previousTab?.testId ?? '(missing)'}`)
  }

  this.remember('activeTabBeforeShortcutClose', {
    id: activeTab.testId.slice(TAB_PILL_TEST_ID_PREFIX.length),
    testId: activeTab.testId,
    title: activeTab.title,
  })
  this.remember('expectedActiveTabAfterClose', {
    id: previousTab.testId.slice(TAB_PILL_TEST_ID_PREFIX.length),
    testId: previousTab.testId,
    title: previousTab.title,
  })
  this.remember('tabCountBeforeClose', tabs.length)
})

When('我用快捷键关闭当前活跃标签页', async function (this: CradleWorld) {
  if (!this.maybeRecall('activeTabBeforeShortcutClose')) {
    this.remember('activeTabBeforeShortcutClose', await readActiveTab(this))
    this.remember('tabCountBeforeClose', await getTabCount(this))
  }

  await pressCloseActiveTabShortcut(this)
})

Then('已关闭的标签页不应再次出现', async function (this: CradleWorld) {
  const closedTab = this.recall<{ id: string, testId: string, title: string | null }>('activeTabBeforeShortcutClose')
  await expect(this.page.locator(`[data-testid="${closedTab.testId}"]`)).toHaveCount(0, { timeout: 10_000 })
  await this.page.waitForTimeout(300)
  await expect(this.page.locator(`[data-testid="${closedTab.testId}"]`)).toHaveCount(0)
})

Then('左侧相邻标签页应处于活跃状态', async function (this: CradleWorld) {
  const expectedTab = this.recall<{ id: string, testId: string, title: string | null }>('expectedActiveTabAfterClose')
  await expect(this.page.locator(`[data-testid="${expectedTab.testId}"]`)).toHaveAttribute(TAB_ACTIVE_ATTR, 'true', { timeout: 10_000 })
})
