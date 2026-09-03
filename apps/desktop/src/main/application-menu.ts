import type { MenuItemConstructorOptions } from 'electron'
import { app, Menu } from 'electron'

import { isDesktopUpdateSupported } from './update-manager'

export interface ApplicationMenuActions {
  checkForUpdates: () => void
  openSettings: () => void
  quit: (triggeredByCommandQ: boolean) => void
}

/**
 * Installs the native macOS application menu. Electron's default menu has no
 * "Check for Updates…" entry, so Sparkle-driven updates were only reachable
 * through Settings. The first submenu always renders under the app name.
 */
export function setupApplicationMenu(actions: ApplicationMenuActions): void {
  if (process.platform !== 'darwin') {
    return
  }

  const zh = app.getLocale().startsWith('zh')
  const labels = {
    checkForUpdates: zh ? '检查更新…' : 'Check for Updates…',
    quit: zh ? `退出 ${app.name}` : `Quit ${app.name}`,
    settings: zh ? '设置…' : 'Settings…',
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          id: 'check-for-updates',
          label: labels.checkForUpdates,
          enabled: isDesktopUpdateSupported(),
          click: () => actions.checkForUpdates(),
        },
        {
          label: labels.settings,
          accelerator: 'CmdOrCtrl+,',
          click: () => actions.openSettings(),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          label: labels.quit,
          accelerator: 'Command+Q',
          click: (_menuItem, _window, event) => actions.quit(event.triggeredByAccelerator === true),
        },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
