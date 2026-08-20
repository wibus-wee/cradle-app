import type { Meta, StoryObj } from '@storybook/react-vite'

import type { ResourceSnapshot } from './resources-popover-view'
import { ResourcesPopoverView } from './resources-popover-view'

const megabytes = (value: number) => value * 1024 * 1024

const snapshot: ResourceSnapshot = {
  rendererHeapUsed: megabytes(148),
  rendererHeapTotal: megabytes(196),
  rendererHeapLimit: megabytes(4096),
  serverRss: megabytes(312),
  serverHeapUsed: megabytes(176),
  serverHeapTotal: megabytes(214),
  serverExternal: megabytes(28),
  serverCpuPercent: 2.4,
  serverUptime: 18432,
  cliTuiRss: megabytes(86),
  cliTuiCpuPercent: 0.8,
  bottomPanelRss: megabytes(42),
  bottomPanelCpuPercent: 0.2,
  chronicleRunning: true,
  chroniclePid: 40210,
  chronicleRss: megabytes(96),
  chronicleCpuPercent: 0.4,
  opencodeRunning: true,
  opencodeRss: megabytes(122),
  opencodeCpuPercent: 1.1,
  opencodeUptime: 9300,
  opencodeResources: [{ pid: 40100, rssMB: 122, cpuPercent: 1.1 }],
  kimiRunning: false,
  kimiRss: 0,
  kimiCpuPercent: null,
  kimiResources: [],
  codexAppServerRunning: true,
  codexAppServerRss: megabytes(164),
  codexAppServerCpuPercent: 0.9,
  codexAppServerResources: [{ pid: 40180, rssMB: 164, cpuPercent: 0.9 }],
  relaySource: 'managed',
  relayRunning: true,
  relayPid: 39912,
  relayRss: megabytes(74),
  relayCpuPercent: 1.7,
  terminals: [
    {
      id: 'terminal-1',
      role: 'cli-tui',
      pid: 40300,
      executable: '/opt/homebrew/bin/codex',
      cwd: '/workspace/cradle-app',
      running: true,
      startedAt: Date.now() - 600000,
      cols: 120,
      rows: 36,
      rssMB: 86,
      cpuPercent: 0.8,
      descendantCount: 2,
    },
  ],
  timestamp: Date.now(),
  updatedAtLabel: '15:42:08',
  warnings: [],
}

const meta = {
  title: 'Devtool/Resources Popover View',
  component: ResourcesPopoverView,
  parameters: { layout: 'centered' },
  args: {
    open: true,
    snapshot,
    loading: false,
    resourcesReady: true,
    onOpenChange: () => {},
    onRefresh: () => {},
  },
  decorators: [Story => <div className="flex min-h-96 min-w-3xl items-end justify-end p-8"><Story /></div>],
} satisfies Meta<typeof ResourcesPopoverView>

export default meta

type Story = StoryObj<typeof meta>

export const ManagedRelay: Story = {}

export const ExternalRelay: Story = {
  args: {
    snapshot: {
      ...snapshot,
      relaySource: 'external',
      relayRunning: false,
      relayPid: null,
      relayRss: 0,
      relayCpuPercent: null,
    },
  },
}
