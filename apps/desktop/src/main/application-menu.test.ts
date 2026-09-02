import type { MenuItemConstructorOptions } from 'electron'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  app: {
    getLocale: vi.fn(() => 'en-US'),
    name: 'Cradle',
  },
  Menu: {
    buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => template),
    setApplicationMenu: vi.fn(),
  },
}))

vi.mock('electron', () => electronMocks)
vi.mock('./update-manager', () => ({ isDesktopUpdateSupported: () => true }))

describe('application menu', () => {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
  })

  beforeEach(() => {
    electronMocks.Menu.buildFromTemplate.mockClear()
    electronMocks.Menu.setApplicationMenu.mockClear()
  })

  afterAll(() => {
    Object.defineProperty(process, 'platform', platformDescriptor)
  })

  it('distinguishes Command+Q from clicking the Quit menu item', async () => {
    const { setupApplicationMenu } = await import('./application-menu')
    const quit = vi.fn()

    setupApplicationMenu({
      checkForUpdates: vi.fn(),
      openSettings: vi.fn(),
      quit,
    })

    const template = electronMocks.Menu.buildFromTemplate.mock.calls[0]?.[0]
    const appMenu = template?.[0]
    const submenu = Array.isArray(appMenu?.submenu) ? appMenu.submenu : []
    const quitItem = submenu.find(item => item.accelerator === 'Command+Q')

    quitItem?.click?.({} as Electron.MenuItem, undefined, { triggeredByAccelerator: true } as Electron.KeyboardEvent)
    quitItem?.click?.({} as Electron.MenuItem, undefined, { triggeredByAccelerator: false } as Electron.KeyboardEvent)

    expect(quit).toHaveBeenNthCalledWith(1, true)
    expect(quit).toHaveBeenNthCalledWith(2, false)
  })
})
