import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Dismiss transient UI that intercepts clicks (onboarding / What's New).
 * Prefer launch()-time localStorage dismiss; this is a runtime safety net.
 */
export async function dismissTransientOverlays(page: Page): Promise<void> {
  const popup = page.locator('[data-testid="whats-new-popup"]')
  if (await popup.isVisible().catch(() => false)) {
    await popup.getByRole('button', { name: /Later|稍后|Close|关闭|Got it|知道了/i }).first().click().catch(() => undefined)
    await expect(popup).toBeHidden({ timeout: 5_000 }).catch(() => undefined)
  }

  const dialogs = page.locator('[role="dialog"]').filter({ hasText: /Welcome|欢迎|What's New|新功能/i })
  const count = await dialogs.count()
  for (let i = 0; i < count; i++) {
    const dialog = dialogs.nth(i)
    if (!(await dialog.isVisible().catch(() => false))) {
      continue
    }
    await dialog.getByRole('button', { name: /Close|关闭|Skip|跳过|Later|稍后/i }).first().click().catch(() => undefined)
  }
}
