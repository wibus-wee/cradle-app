import { existsSync, readFileSync } from 'node:fs'

import type { PluginDescriptor } from '@cradle/plugin-sdk'
import { expect } from '@playwright/test'

import type { CradleWorld } from '../world'

const PLUGIN_TIMEOUT = 20_000
const PACKAGE_NAME = '@cradle/e2e-visible-panel'
const DISPLAY_NAME = 'E2E Visible Panel'
const PERSONAL_IDENTITY = '@cradle/e2e-personal-panel'
const PERSONAL_PERMISSION = 'workspace.metadata.read'

interface PluginSourceResponse {
  id: string
  kind: string
  location: string
  resolvedDirectory: string | null
  plugins: PluginDescriptor[]
}

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

  private async personalSource(): Promise<PluginSourceResponse> {
    const response = await fetch(`${this.world.params.serverUrl}/plugins/sources`)
    expect(response.ok).toBe(true)
    const sources: PluginSourceResponse[] = await response.json()
    const source = sources.find(candidate => candidate.kind === 'personal'
      && candidate.plugins.some(plugin => plugin.identity === PERSONAL_IDENTITY))
    expect(source, 'Expected the personal Plugin source to be installed').toBeDefined()
    return source!
  }

  private async personalDescriptor(): Promise<PluginDescriptor> {
    const response = await fetch(`${this.world.params.serverUrl}/plugins`)
    expect(response.ok).toBe(true)
    const plugins: PluginDescriptor[] = await response.json()
    const plugin = plugins.find(candidate => candidate.identity === PERSONAL_IDENTITY)
    expect(plugin, 'Expected the personal Plugin descriptor').toBeDefined()
    return plugin!
  }

  async expectPersonalReview(): Promise<void> {
    const card = this.page.locator('[data-testid="personal-plugin-review-card"]')
    await expect(card).toBeVisible({ timeout: PLUGIN_TIMEOUT })
    await expect(card).toContainText('E2E Personal Panel')
    await expect(card).toContainText('Read workspace metadata')
    await expect(card).toContainText('web: disabled')
    await expect(card.getByRole('button', { name: 'Review & activate' })).toBeVisible()
  }

  async expectNoPersonalReview(): Promise<void> {
    await expect(this.page.locator('[data-testid="personal-plugin-review-card"]')).toHaveCount(0, { timeout: PLUGIN_TIMEOUT })
  }

  async expectPersonalSnapshotInstalled(): Promise<void> {
    const source = await this.personalSource()
    const plugin = await this.personalDescriptor()
    expect(source.resolvedDirectory).not.toBeNull()
    expect(source.resolvedDirectory).not.toBe(source.location)
    expect(existsSync(source.resolvedDirectory!)).toBe(true)
    expect(plugin.source.packageDir.startsWith(`${source.resolvedDirectory}/`)).toBe(true)
    expect(plugin.source.packageDir).not.toBe(source.location)
    expect(existsSync(plugin.source.packageDir)).toBe(true)
    expect(plugin.source.trusted).toBe(false)
    expect(plugin.source.grantedPermissions ?? []).toEqual([])
    expect(plugin.layers.web.status).toBe('disabled')
    expect(readFileSync(`${plugin.source.packageDir}/dist/web.mjs`, 'utf8')).toContain('revision v1')
    expect(plugin.source.checksum).toBeTruthy()
    this.world.remember('personal-plugin.v1-checksum', plugin.source.checksum!)
    this.world.remember('personal-plugin.source-id', source.id)
  }

  async reviewAndActivatePersonalPlugin(): Promise<void> {
    const card = this.page.locator('[data-testid="personal-plugin-review-card"]')
    await card.getByRole('button', { name: 'Review & activate' }).click()
    await this.expectNoPersonalReview()
  }

  async expectPersonalPanel(version: 'v1' | 'v2'): Promise<void> {
    const link = this.page.locator('[data-testid="plugin-panel-link-personal-lifecycle"]')
    const panel = this.page.locator('[data-testid="e2e-personal-plugin-panel"]')
    if (!await panel.isVisible()) {
      if (await this.world.chat.view().isVisible()) {
        this.world.remember('personal-plugin.chat-session-id', await this.world.chat.sessionId())
        await expect(link).toBeVisible({ timeout: PLUGIN_TIMEOUT })
        await link.click()
      }
      else {
        await expect(panel).toBeVisible({ timeout: PLUGIN_TIMEOUT })
      }
    }
    await expect(panel).toContainText(`Personal Plugin revision ${version}`, { timeout: PLUGIN_TIMEOUT })
  }

  async returnToOriginatingChat(): Promise<void> {
    await this.world.chat.openSession(this.world.recall<string>('personal-plugin.chat-session-id'))
  }

  async expectPersonalPanelUnavailable(): Promise<void> {
    await expect(this.page.locator('[data-testid="plugin-panel-link-personal-lifecycle"]'))
      .toHaveCount(0, { timeout: PLUGIN_TIMEOUT })
  }

  async expectPersonalPluginGranted(version: 'v1' | 'v2'): Promise<void> {
    const plugin = await this.personalDescriptor()
    expect(plugin.activation.enabled).toBe(true)
    expect(plugin.source.trusted).toBe(true)
    expect(plugin.source.grantedPermissions).toEqual([PERSONAL_PERMISSION])
    expect(plugin.layers.web.status).toBe('discovered')
    expect(plugin.source.checksum).toBe(this.world.recall(`personal-plugin.${version}-checksum`))
  }

  async expectFailedUpdatePreserved(): Promise<void> {
    const source = await this.personalSource()
    const plugin = await this.personalDescriptor()
    expect(source.id).toBe(this.world.recall('personal-plugin.source-id'))
    expect(plugin.source.checksum).toBe(this.world.recall('personal-plugin.v1-checksum'))
    expect(plugin.source.trusted).toBe(true)
    expect(plugin.source.grantedPermissions).toEqual([PERSONAL_PERMISSION])
    expect(plugin.layers.web.status).toBe('discovered')
    expect(readFileSync(`${plugin.source.packageDir}/dist/web.mjs`, 'utf8')).toContain('revision v1')
  }

  async expectUpdatedSnapshotPendingReview(): Promise<void> {
    const source = await this.personalSource()
    const plugin = await this.personalDescriptor()
    const v1Checksum = this.world.recall<string>('personal-plugin.v1-checksum')
    expect(source.id).toBe(this.world.recall('personal-plugin.source-id'))
    expect(plugin.source.checksum).toBeTruthy()
    expect(plugin.source.checksum).not.toBe(v1Checksum)
    expect(plugin.source.trusted).toBe(false)
    expect(plugin.source.grantedPermissions ?? []).toEqual([])
    expect(plugin.layers.web.status).toBe('disabled')
    expect(readFileSync(`${plugin.source.packageDir}/dist/web.mjs`, 'utf8')).toContain('revision v2')
    this.world.remember('personal-plugin.v2-checksum', plugin.source.checksum!)
  }
}
