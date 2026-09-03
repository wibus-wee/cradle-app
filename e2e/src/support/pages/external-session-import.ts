import { readFileSync } from 'node:fs'

import { expect } from '@playwright/test'

import {
  EXTERNAL_SESSION_ID,
  EXTERNAL_SESSION_REPLY,
  EXTERNAL_SESSION_TITLE,
} from '../helpers/external-session-import-scenario'
import type { CradleWorld } from '../world'

const IMPORT_TIMEOUT = 30_000

interface ExternalSessionImportRecord {
  id: string
  externalSessionId: string
  sessionId: string
  workspaceId: string
  fidelityJson: string
  status: string
}

export class ExternalSessionImportPage {
  constructor(private readonly world: CradleWorld) {}

  private get page() {
    return this.world.page
  }

  private root() {
    return this.page.locator('[data-testid="external-work-import-settings"]')
  }

  private candidateRow() {
    return this.root().locator('div.border-b').filter({ hasText: EXTERNAL_SESSION_TITLE }).first()
  }

  async open(): Promise<void> {
    await this.world.search.open()
    await this.world.search.fill('>settings')
    await this.world.search.runCommand('Open settings')
    await this.world.settingsPage.expectSettingsMode()
    await this.page.locator('[data-testid="settings-nav-import"]').click()
    await expect(this.root()).toBeVisible({ timeout: IMPORT_TIMEOUT })
  }

  async scan(): Promise<void> {
    await this.root().getByRole('button', { name: /Scan(?: again)?/ }).click()
    await expect(this.page.locator('[data-testid="external-work-import-status"]'))
      .toContainText(/Found [1-9]\d* session candidates\./, { timeout: IMPORT_TIMEOUT })
    await expect(this.candidateRow()).toBeVisible({ timeout: IMPORT_TIMEOUT })
    await expect(this.candidateRow()).toContainText('claude')
    await expect(this.candidateRow()).toContainText('Ready')
  }

  async importCandidate(): Promise<void> {
    const checkbox = this.candidateRow().getByRole('checkbox', {
      name: `Select ${EXTERNAL_SESSION_TITLE}`,
    })
    await checkbox.click()
    await expect(checkbox).toBeChecked()
    await this.root().getByRole('button', { name: /^Import 1$/ }).click()
    await expect(this.page.locator('[data-testid="external-work-import-status"]'))
      .toContainText('Imported 1, skipped 0, duplicates 0, errors 0.', {
        timeout: IMPORT_TIMEOUT,
      })
    await expect(this.candidateRow()).toContainText('Imported', { timeout: IMPORT_TIMEOUT })
  }

  async openImportedSession(): Promise<void> {
    await expect(this.root().getByText('Results', { exact: true })).toBeVisible({
      timeout: IMPORT_TIMEOUT,
    })
    await this.root().getByRole('button', { name: 'Open', exact: true }).last().click()
    await this.world.chat.waitVisible(IMPORT_TIMEOUT)
    await this.world.chat.expectUserMessage(EXTERNAL_SESSION_TITLE)
    await this.world.chat.expectAssistantContains(EXTERNAL_SESSION_REPLY)
    this.world.remember('external-import.session-id', await this.world.chat.sessionId())
  }

  async expectPersistedTranscript(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' })
    await this.world.chat.waitVisible(IMPORT_TIMEOUT)
    expect(await this.world.chat.sessionId()).toBe(this.world.recall<string>('external-import.session-id'))
    await this.world.chat.expectUserMessage(EXTERNAL_SESSION_TITLE)
    await this.world.chat.expectAssistantContains(EXTERNAL_SESSION_REPLY)
  }

  async expectIdempotentSourceOwnership(): Promise<void> {
    await this.open()
    await this.root().getByRole('button', { name: /Scan(?: again)?/ }).click()
    await expect(this.candidateRow()).toContainText('Imported', { timeout: IMPORT_TIMEOUT })
    await expect(this.candidateRow().getByRole('checkbox', {
      name: `Select ${EXTERNAL_SESSION_TITLE}`,
    })).toBeDisabled()

    const response = await fetch(`${this.world.params.serverUrl}/external-session-import/imports`)
    expect(response.ok).toBe(true)
    const records = await response.json() as ExternalSessionImportRecord[]
    const matches = records.filter(record => record.externalSessionId === EXTERNAL_SESSION_ID)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      sessionId: this.world.recall<string>('external-import.session-id'),
      status: 'imported',
    })
    expect(JSON.parse(matches[0]!.fidelityJson)).toMatchObject({ messages: 2 })

    expect(readFileSync(this.world.recall<string>('external-import.source-path')))
      .toEqual(this.world.recall<Buffer>('external-import.source-bytes'))
  }
}
