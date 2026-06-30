import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

import {
  fillPromptEditor,
  newChatSendButton,
  newChatTextBox,
  visibleChatView,
  visibleNewChatEntry,
} from '../support/ui'
import type { CradleWorld } from '../support/world'

const APP_SIDEBAR = '[data-testid="app-sidebar"]'
const WORKSPACE_LIST = '[data-testid="workspace-list"]'
const SETTINGS_NAV = '[data-testid="settings-nav-appearance"]'
const TAB_BAR = '[data-testid="surface-bar"]'
const TAB_PILL = '[data-testid^="surface-pill-"]'
const TAB_NEW_BUTTON = '[data-testid="surface-new-btn"]'
const RIGHT_ASIDE = '[data-testid="app-layout-right-aside"]'
const BOTTOM_PANEL = '[data-testid="app-layout-bottom-panel"]'
const HEADER_ASIDE_TOGGLE = '[data-testid="app-header-aside-toggle"]'
const HEADER_PANEL_TOGGLE = '[data-testid="app-header-panel-toggle"]'
const TAB_COUNT_KEY = 'keyboard-shortcuts.initial-tab-count'
const NON_EMPTY_RE = /.+/

type ModifierKey = 'Meta' | 'Control' | 'Alt'
type ShortcutName
  = | 'open-settings'
    | 'exit-settings'
    | 'toggle-sidebar'
    | 'toggle-right-aside'
    | 'toggle-bottom-panel'
    | 'new-tab'
    | 'close-tab'
    | 'first-tab'
    | 'next-tab'

const SHORTCUTS: Record<ShortcutName, { key: string, modifiers: ModifierKey[] }> = {
  'open-settings': { key: 'Comma', modifiers: ['Meta'] },
  'exit-settings': { key: 'Escape', modifiers: ['Meta'] },
  'toggle-sidebar': { key: 'KeyB', modifiers: ['Meta'] },
  'toggle-right-aside': { key: 'KeyB', modifiers: ['Meta', 'Alt'] },
  'toggle-bottom-panel': { key: 'Backquote', modifiers: ['Control'] },
  'new-tab': { key: 'KeyT', modifiers: ['Meta'] },
  'close-tab': { key: 'KeyW', modifiers: ['Meta'] },
  'first-tab': { key: 'Digit1', modifiers: ['Meta'] },
  'next-tab': { key: 'Tab', modifiers: ['Control'] },
}

async function waitForShell(world: CradleWorld): Promise<void> {
  await world.page.waitForLoadState('domcontentloaded')
  await expect(world.page.locator(APP_SIDEBAR)).toBeVisible({ timeout: 15_000 })
  await expect(world.page.locator(TAB_BAR)).toBeVisible({ timeout: 15_000 })
}

async function pressShortcut(world: CradleWorld, shortcutName: ShortcutName): Promise<void> {
  const { key, modifiers } = SHORTCUTS[shortcutName]

  console.warn(`[step] press shortcut: ${shortcutName}`)

  for (const modifier of modifiers) {
    await world.page.keyboard.down(modifier)
  }

  try {
    await world.page.keyboard.press(key)
  }
  finally {
    for (const modifier of [...modifiers].reverse()) {
      await world.page.keyboard.up(modifier)
    }
  }
}

async function getTabCount(world: CradleWorld): Promise<number> {
  return world.page.locator(TAB_PILL).count()
}

async function waitForTabCount(world: CradleWorld, count: number): Promise<void> {
  await expect(world.page.locator(TAB_PILL)).toHaveCount(count, { timeout: 10_000 })
}

async function closeTabAtIndex(world: CradleWorld, index: number): Promise<void> {
  const before = await getTabCount(world)
  const tab = world.page.locator(TAB_PILL).nth(index)

  await expect(tab).toBeVisible({ timeout: 10_000 })
  await tab.hover()

  const closeButton = tab.locator('[data-testid^="surface-close-"]')
  await expect(closeButton).toBeVisible({ timeout: 10_000 })
  await closeButton.click()

  await waitForTabCount(world, before - 1)
}

async function ensureSingleInitialTab(world: CradleWorld): Promise<void> {
  await waitForShell(world)

  while (await getTabCount(world) > 1) {
    const count = await getTabCount(world)
    await closeTabAtIndex(world, count - 1)
  }

  await waitForTabCount(world, 1)
}

async function _getActiveTab(world: CradleWorld) {
  const activeTab = world.page.locator(`${TAB_PILL}[data-surface-active="true"]`).first()
  await expect(activeTab).toBeVisible({ timeout: 10_000 })
  return activeTab
}

async function addWorkspaceFromPicker(world: CradleWorld, dirPath: string): Promise<void> {
  const addButton = world.page.locator('[data-testid="add-workspace-btn"]')
  await expect(addButton).toBeVisible({ timeout: 10_000 })
  await addButton.click()

  await world.selectDirectoryInBrowser(dirPath)

  // Wait for at least one workspace group to be visible after adding
  await expect(world.page.locator('[data-testid^="workspace-group-"]').first()).toBeVisible({ timeout: 10_000 })
}

async function getActiveChatView(world: CradleWorld) {
  const chatView = visibleChatView(world)
  await expect(chatView).toBeVisible({ timeout: 20_000 })
  return chatView
}

async function waitForChatLayoutReady(world: CradleWorld): Promise<void> {
  const chatView = await getActiveChatView(world)

  await expect(chatView).toHaveAttribute('data-chat-session-id', NON_EMPTY_RE, { timeout: 20_000 })
  await expect(world.page.locator(HEADER_ASIDE_TOGGLE)).toBeVisible({ timeout: 15_000 })
  await expect(world.page.locator(HEADER_PANEL_TOGGLE)).toBeVisible({ timeout: 15_000 })
  await expect(world.page.locator(RIGHT_ASIDE)).toHaveCount(1, { timeout: 15_000 })
  await expect(world.page.locator(BOTTOM_PANEL)).toHaveCount(1, { timeout: 15_000 })
}

async function setLayoutRegionOpen(world: CradleWorld, region: 'aside' | 'panel', open: boolean): Promise<void> {
  const target = region === 'aside' ? world.page.locator(RIGHT_ASIDE) : world.page.locator(BOTTOM_PANEL)
  const toggle = region === 'aside' ? world.page.locator(HEADER_ASIDE_TOGGLE) : world.page.locator(HEADER_PANEL_TOGGLE)
  const attrName = region === 'aside' ? 'data-aside-open' : 'data-panel-open'
  const current = await target.getAttribute(attrName)

  if ((current === 'true') !== open) {
    await toggle.click()
  }

  await expect(target).toHaveAttribute(attrName, open ? 'true' : 'false', { timeout: 10_000 })
}

async function resetLayoutPanels(world: CradleWorld): Promise<void> {
  await setLayoutRegionOpen(world, 'aside', false)
  await setLayoutRegionOpen(world, 'panel', false)
}

Given('应用 shell 已加载', async function (this: CradleWorld) {
  await waitForShell(this)
})

Given('仅保留一个初始标签页', async function (this: CradleWorld) {
  console.warn('[step] keep only one initial tab')
  await ensureSingleInitialTab(this)
})

Given('当前标签页总数已被记录', async function (this: CradleWorld) {
  const count = await getTabCount(this)
  this.remember(TAB_COUNT_KEY, count)
})

Given('我已准备好一个带工作区的聊天标签页', async function (this: CradleWorld) {
  console.warn('[step] prepare chat tab with workspace for shortcut assertions')

  await waitForShell(this)
  await this.configureMockLlmProvider({
    responseText: 'Keyboard shortcuts fixture reply.',
    chunkDelay: 5,
  })

  const workspaceDir = this.createTempWorkspaceDir('cradle-e2e-shortcuts-')
  writeFileSync(join(workspaceDir, 'README.md'), '# Keyboard shortcuts workspace\n', 'utf8')

  await addWorkspaceFromPicker(this, workspaceDir)

  const newChatNav = this.page.locator('[data-testid="nav-new-chat"]')
  await expect(newChatNav).toBeVisible({ timeout: 10_000 })
  await newChatNav.click()

  const entry = visibleNewChatEntry(this)
  await fillPromptEditor(newChatTextBox(entry), '用来验证 shell 布局快捷键的测试消息')

  const sendButton = newChatSendButton(entry)
  await expect(sendButton).toBeEnabled({ timeout: 15_000 })
  await sendButton.click()

  await waitForChatLayoutReady(this)
  await resetLayoutPanels(this)
})

When('我按下打开设置的快捷键', async function (this: CradleWorld) {
  await pressShortcut(this, 'open-settings')
})

When('我按下退出设置的快捷键', async function (this: CradleWorld) {
  await pressShortcut(this, 'exit-settings')
})

When('我按下切换侧边栏的快捷键', async function (this: CradleWorld) {
  await pressShortcut(this, 'toggle-sidebar')
})

When('我按下切换右侧 aside 的快捷键', async function (this: CradleWorld) {
  await pressShortcut(this, 'toggle-right-aside')
})

When('我按下切换底部 panel 的快捷键', async function (this: CradleWorld) {
  await pressShortcut(this, 'toggle-bottom-panel')
})

When('我按下新建标签的快捷键', async function (this: CradleWorld) {
  await pressShortcut(this, 'new-tab')
})

When('我按下关闭当前标签页的快捷键', async function (this: CradleWorld) {
  await pressShortcut(this, 'close-tab')
})

When('我按下切换到第一个标签页的快捷键', async function (this: CradleWorld) {
  await pressShortcut(this, 'first-tab')
})

When('我按下切换到下一个标签页的快捷键', async function (this: CradleWorld) {
  await pressShortcut(this, 'next-tab')
})

When('我点击 Header 新建标签按钮', async function (this: CradleWorld) {
  const button = this.page.locator(TAB_NEW_BUTTON)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
})

When('我点击 Header 右侧 aside 按钮', async function (this: CradleWorld) {
  const button = this.page.locator(HEADER_ASIDE_TOGGLE)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
})

When('我点击 Header 底部 panel 按钮', async function (this: CradleWorld) {
  const button = this.page.locator(HEADER_PANEL_TOGGLE)
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
})

Then('侧边栏应处于设置模式', async function (this: CradleWorld) {
  const sidebar = this.page.locator(APP_SIDEBAR)
  await expect(sidebar).toHaveAttribute('data-sidebar-mode', 'settings', { timeout: 10_000 })
  await expect(this.page.locator(SETTINGS_NAV)).toBeVisible({ timeout: 10_000 })
})

Then('侧边栏应处于主导航模式', async function (this: CradleWorld) {
  const sidebar = this.page.locator(APP_SIDEBAR)
  await expect(sidebar).toHaveAttribute('data-sidebar-mode', 'main', { timeout: 10_000 })
  await expect(this.page.locator(WORKSPACE_LIST)).toBeVisible({ timeout: 10_000 })
})

Then('侧边栏应处于展开状态', async function (this: CradleWorld) {
  await expect(this.page.locator(APP_SIDEBAR)).toHaveAttribute('data-sidebar-collapsed', 'false', { timeout: 10_000 })
})

Then('侧边栏应处于折叠状态', async function (this: CradleWorld) {
  await expect(this.page.locator(APP_SIDEBAR)).toHaveAttribute('data-sidebar-collapsed', 'true', { timeout: 10_000 })
})

Then('右侧 aside 应处于关闭状态', async function (this: CradleWorld) {
  await expect(this.page.locator(RIGHT_ASIDE)).toHaveAttribute('data-aside-open', 'false', { timeout: 10_000 })
})

Then('右侧 aside 应处于打开状态', async function (this: CradleWorld) {
  await expect(this.page.locator(RIGHT_ASIDE)).toHaveAttribute('data-aside-open', 'true', { timeout: 10_000 })
})

Then('底部 panel 应处于关闭状态', async function (this: CradleWorld) {
  await expect(this.page.locator(BOTTOM_PANEL)).toHaveAttribute('data-panel-open', 'false', { timeout: 10_000 })
})

Then('底部 panel 应处于打开状态', async function (this: CradleWorld) {
  await expect(this.page.locator(BOTTOM_PANEL)).toHaveAttribute('data-panel-open', 'true', { timeout: 10_000 })
})

Then('标签页总数应比记录值增加 {int}', async function (this: CradleWorld, delta: number) {
  const initialCount = this.recall<number>(TAB_COUNT_KEY)
  await waitForTabCount(this, initialCount + delta)
})

Then('标签页总数应恢复为记录值', async function (this: CradleWorld) {
  const initialCount = this.recall<number>(TAB_COUNT_KEY)
  await waitForTabCount(this, initialCount)
})

Then('最后一个标签页应处于活跃状态', async function (this: CradleWorld) {
  const tabs = this.page.locator(TAB_PILL)
  const lastIndex = (await tabs.count()) - 1
  await expect(tabs.nth(lastIndex)).toHaveAttribute('data-surface-active', 'true', { timeout: 10_000 })
})
