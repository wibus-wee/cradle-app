import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const TIMEOUT = 10_000

export class SettingsPage {
  constructor(private readonly page: Page) {}

  sidebar() {
    return this.page.locator('[data-testid="app-sidebar"]')
  }

  async expectSettingsMode(): Promise<void> {
    await expect(this.sidebar()).toHaveAttribute('data-sidebar-mode', 'settings', { timeout: TIMEOUT })
    await expect(this.page.locator('[data-testid="settings-nav-appearance"]')).toBeVisible({ timeout: TIMEOUT })
  }

  async expectAppearancePage(): Promise<void> {
    const settings = this.page.locator('[data-testid="appearance-settings"]')
    await expect(settings).toBeVisible({ timeout: TIMEOUT })
    await expect(settings).toHaveAttribute('data-settings-appearance-ready', 'true', { timeout: TIMEOUT })
  }

  serverEndpointSettings() {
    return this.page.locator('[data-testid="server-endpoint-settings"]')
  }

  serverEndpointInput() {
    return this.page.locator('[data-testid="server-endpoint-url-input"]')
  }

  reachableServerAlias(serverUrl: string): string {
    const alias = new URL(serverUrl)
    if (alias.hostname !== '127.0.0.1') {
      throw new Error(`Server Endpoint journey requires the managed 127.0.0.1 server, received ${serverUrl}`)
    }
    alias.hostname = 'localhost'
    return alias.toString().replace(/\/$/, '')
  }

  async expectServerEndpoint(defaultUrl: string, mode: 'Default' | 'Custom', activeUrl: string): Promise<void> {
    const settings = this.serverEndpointSettings()
    await expect(settings).toBeVisible({ timeout: TIMEOUT })
    await expect(settings.getByText(mode, { exact: true })).toBeVisible({ timeout: TIMEOUT })
    await expect(settings.getByText('Active endpoint', { exact: true })).toBeVisible({ timeout: TIMEOUT })
    await expect(settings.getByText(activeUrl, { exact: true }).first()).toBeVisible({ timeout: TIMEOUT })
    await expect(settings.getByText(defaultUrl, { exact: true }).first()).toBeVisible({ timeout: TIMEOUT })
    await expect(this.serverEndpointInput()).toHaveValue(activeUrl, { timeout: TIMEOUT })
  }

  async enterServerEndpoint(value: string): Promise<void> {
    const input = this.serverEndpointInput()
    await expect(input).toBeVisible({ timeout: TIMEOUT })
    await input.fill(value)
  }

  async attemptSave(): Promise<void> {
    await this.serverEndpointSettings().getByRole('button', { name: 'Save and reload', exact: true }).click()
  }

  async expectInvalidServerEndpoint(defaultUrl: string): Promise<void> {
    const settings = this.serverEndpointSettings()
    await expect(this.serverEndpointInput()).toHaveAttribute('aria-invalid', 'true', { timeout: TIMEOUT })
    await expect(settings.getByText('Enter a valid http:// or https:// URL.', { exact: true })).toBeVisible({ timeout: TIMEOUT })
    await expect(settings.getByText('Default', { exact: true })).toBeVisible({ timeout: TIMEOUT })
    await expect(settings.getByText(defaultUrl, { exact: true }).first()).toBeVisible({ timeout: TIMEOUT })
  }

  async testServerEndpoint(): Promise<void> {
    await this.serverEndpointSettings().getByRole('button', { name: 'Test connection', exact: true }).click()
  }

  async expectConnectionSucceeded(): Promise<void> {
    await expect(this.serverEndpointSettings().getByText('Connection succeeded.', { exact: true })).toBeVisible({
      timeout: TIMEOUT,
    })
  }

  async saveAndWaitForReload(): Promise<void> {
    await this.clickAndWaitForReload('Save and reload')
  }

  async restoreDefaultAndWaitForReload(): Promise<void> {
    await this.clickAndWaitForReload('Use default')
  }

  async expectApplicationStarted(): Promise<void> {
    await expect(this.sidebar()).toBeVisible({ timeout: TIMEOUT })
    await this.expectSettingsMode()
    await expect(this.serverEndpointSettings()).toBeVisible({ timeout: TIMEOUT })
  }

  private async clickAndWaitForReload(buttonName: string): Promise<void> {
    const reloaded = this.page.waitForEvent('framenavigated', frame => frame === this.page.mainFrame())
    await this.serverEndpointSettings().getByRole('button', { name: buttonName, exact: true }).click()
    await reloaded
    await this.page.waitForLoadState('domcontentloaded')
  }
}
