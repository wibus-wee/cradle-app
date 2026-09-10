import { expect } from '@playwright/test'

import { navigateToNewChatWithSimulator } from '../helpers/chat-scenario'
import {
  WORKSPACE_SKILL_DESCRIPTION,
  WORKSPACE_SKILL_NAME,
  WORKSPACE_SKILL_PROMPT,
  WORKSPACE_SKILL_SENTINEL,
} from '../helpers/skill-scenario'
import type { CradleWorld } from '../world'

const SKILL_TIMEOUT = 30_000

export class SkillsPage {
  constructor(private readonly world: CradleWorld) {}

  private get page() {
    return this.world.page
  }

  private manager() {
    return this.page.locator('[data-testid="workspace-skills-page"]')
  }

  private skillRow() {
    return this.manager().getByRole('button', {
      name: `Open ${WORKSPACE_SKILL_NAME} details`,
      exact: true,
    })
  }

  async openWorkspaceSkills(): Promise<void> {
    await this.world.workspacePage.openCurrentWorkspaceDetail()
    await this.page.locator('[data-testid="workspace-detail-tab-skills"]').click()
    await expect(this.manager()).toHaveAttribute('data-workspace-skills-ready', 'true', {
      timeout: SKILL_TIMEOUT,
    })
  }

  async createWorkspaceSkill(): Promise<void> {
    await this.openWorkspaceSkills()
    await this.manager().locator('[data-testid="new-skill-btn"]').click()

    await this.page.locator('[data-testid="skill-name-input"]').fill(WORKSPACE_SKILL_NAME)
    await this.page.locator('[data-testid="skill-desc-input"]').fill(WORKSPACE_SKILL_DESCRIPTION)
    await this.page.locator('[data-testid="skill-body-editor"]').fill([
      '# Release verdict policy',
      '',
      `When invoked, apply the marker ${WORKSPACE_SKILL_SENTINEL}.`,
      'State that the workspace policy was loaded before giving the verdict.',
    ].join('\n'))
    await this.page.locator('[data-testid="skill-save-btn"]').click()

    await expect(this.skillRow()).toBeVisible({ timeout: SKILL_TIMEOUT })
    await expect(this.skillRow()).toContainText(WORKSPACE_SKILL_DESCRIPTION)
  }

  async invokeWorkspaceSkill(): Promise<void> {
    await navigateToNewChatWithSimulator(this.world)
    await this.world.workspacePage.selectCurrentWorkspaceInNewChat()

    const editor = this.world.newChat.textBox()
    await editor.click()
    await editor.fill(`$${WORKSPACE_SKILL_NAME}`)
    const option = this.world.newChat.entry().getByRole('button', {
      name: new RegExp(`^${WORKSPACE_SKILL_NAME}`),
    }).last()
    await expect(option).toBeVisible({ timeout: SKILL_TIMEOUT })
    await option.click()
    await expect(editor.locator(`[data-skill-mention-name="${WORKSPACE_SKILL_NAME}"]`))
      .toBeVisible({ timeout: SKILL_TIMEOUT })
    await editor.pressSequentially(` ${WORKSPACE_SKILL_PROMPT}`)
    await this.world.newChat.send()
    await this.world.chat.waitStatus('idle', 60_000)

    this.world.remember('skill.session-id', await this.world.chat.sessionId())
  }

  async expectPersistedInvocation(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' })
    await this.world.chat.waitStatus('idle', SKILL_TIMEOUT)
    const userBubble = this.page.locator('[data-testid="message-bubble-user"]').last()
    await expect(userBubble).toContainText(`$${WORKSPACE_SKILL_NAME}`, { timeout: SKILL_TIMEOUT })
    await expect(userBubble).toContainText(WORKSPACE_SKILL_PROMPT, { timeout: SKILL_TIMEOUT })
  }

  async deleteWorkspaceSkill(): Promise<void> {
    await this.openWorkspaceSkills()
    await this.skillRow().click()
    await expect(this.page.locator('[data-testid="skill-delete-btn"]')).toBeVisible({
      timeout: SKILL_TIMEOUT,
    })
    await this.page.locator('[data-testid="skill-delete-btn"]').click()
    await expect(this.skillRow()).toHaveCount(0, { timeout: SKILL_TIMEOUT })
  }

  async expectSkillUnavailableForNewTurn(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' })
    await this.world.newChat.openFromNav()
    await this.world.workspacePage.selectCurrentWorkspaceInNewChat()
    const editor = this.world.newChat.textBox()
    await editor.fill(`$${WORKSPACE_SKILL_NAME}`)
    await expect(this.world.newChat.entry().getByRole('button', {
      name: new RegExp(`^${WORKSPACE_SKILL_NAME}`),
    })).toHaveCount(0, { timeout: SKILL_TIMEOUT })
  }

  async expectHistoricalInvocationStillVisible(): Promise<void> {
    await this.world.chat.openSession(this.world.recall<string>('skill.session-id'))
    await this.world.chat.waitStatus('idle', SKILL_TIMEOUT)
    const userBubble = this.page.locator('[data-testid="message-bubble-user"]').last()
    await expect(userBubble).toContainText(`$${WORKSPACE_SKILL_NAME}`, { timeout: SKILL_TIMEOUT })
    await expect(userBubble).toContainText(WORKSPACE_SKILL_PROMPT, { timeout: SKILL_TIMEOUT })
  }
}
