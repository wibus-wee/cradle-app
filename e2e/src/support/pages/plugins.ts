import { expect } from '@playwright/test'

import type { CradleWorld } from '../world'

const PLUGIN_TIMEOUT = 20_000
const PACKAGE_NAME = '@cradle/e2e-visible-panel'
const DISPLAY_NAME = 'E2E Visible Panel'

export class PluginsPage {
  constructor(private readonly world: CradleWorld) {}

  private get page() {
    return this.world.page
  }

  async openCenter(): Promise<void> {
    const manage = this.page.locator('[data-testid="plugin-panel-manage-link"]')
    await expect(manage).toBeVisible({ timeout: PLUGIN_TIMEOUT })
    await manage.click()
    await expect(this.page.getByRole('heading', { name: 'Plugin Center' })).toBeVisible({ timeout: PLUGIN_TIMEOUT })
  }

  async installFixture(): Promise<void> {
    await this.page.getByRole('tab', { name: 'Import' }).click()
    await this.page.getByRole('textbox', { name: 'Plugin source' }).fill(PACKAGE_NAME)
    await this.page.getByRole('button', { name: 'Preview what will install' }).click()
    await expect(this.page.getByText(DISPLAY_NAME, { exact: true })).toBeVisible({ timeout: PLUGIN_TIMEOUT })
    await this.page.getByRole('button', { name: 'Install 1 plugins' }).click()
    await expect(this.page.getByRole('heading', { name: 'Added', exact: true })).toBeVisible({ timeout: PLUGIN_TIMEOUT })
  }

  async trustAndEnableFixture(): Promise<void> {
    await this.page.getByRole('button', { name: 'Enable' }).click()
    await expect(this.page.getByRole('alertdialog')).toContainText('Trust before enabling', { timeout: PLUGIN_TIMEOUT })
    await this.page.getByRole('button', { name: 'Trust & enable' }).click()
    await this.expectPanelAvailable()
  }

  async expectPanelAvailable(): Promise<void> {
    await expect(this.page.locator('[data-testid="plugin-panel-link-lifecycle"]')).toBeVisible({ timeout: PLUGIN_TIMEOUT })
  }

  async openAndExpectPanel(): Promise<void> {
    await this.page.locator('[data-testid="plugin-panel-link-lifecycle"]').click()
    await expect(this.page.locator('[data-testid="e2e-plugin-lifecycle-panel"]')).toContainText('Plugin lifecycle is active', { timeout: PLUGIN_TIMEOUT })
  }

  async setFixtureEnabled(enabled: boolean): Promise<void> {
    await this.openCenter()
    await this.page.getByRole('tab', { name: 'Installed' }).click()
    const card = this.page.getByRole('listitem').filter({ hasText: DISPLAY_NAME })
    const toggle = card.getByRole('switch', { name: `Toggle ${DISPLAY_NAME}` })
    await expect(toggle).toBeVisible({ timeout: PLUGIN_TIMEOUT })
    if (await toggle.isChecked() !== enabled) {
      await toggle.click()
    }
    await expect(toggle).toBeChecked({ checked: enabled, timeout: PLUGIN_TIMEOUT })
  }

  async expectPanelUnavailable(): Promise<void> {
    await expect(this.page.locator('[data-testid="plugin-panel-link-lifecycle"]')).toHaveCount(0, { timeout: PLUGIN_TIMEOUT })
  }

  async expectServerState(enabled: boolean): Promise<void> {
    const state = await this.page.evaluate(async ({ serverUrl, packageName }) => {
      const response = await fetch(`${serverUrl}/plugins`)
      const plugins = await response.json() as Array<{ name: string, activation: { enabled: boolean } }>
      return plugins.filter(plugin => plugin.name === packageName)
    }, { serverUrl: this.world.params.serverUrl, packageName: PACKAGE_NAME })
    expect(state).toHaveLength(1)
    expect(state[0]?.activation.enabled).toBe(enabled)
  }
}
