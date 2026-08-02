import defaultSettings from '~/locales/default/settings'

import type {
  RemoteHostsSettingsHost,
  RemoteHostsSettingsViewCopy,
} from '../remote-hosts-settings-view'

export const remoteHostsSettingsCopy = {
  title: defaultSettings['remoteHosts.page.title'],
  description: defaultSettings['remoteHosts.page.description'],
  addHost: defaultSettings['remoteHosts.action.addHost'],
  loading: defaultSettings['remoteHosts.loading'],
  emptyTitle: defaultSettings['remoteHosts.empty.title'],
  guideIntro: defaultSettings['remoteHosts.guide.intro'],
  guideToggle: defaultSettings['remoteHosts.guide.toggle'],
  guideSteps: [
    {
      title: defaultSettings['remoteHosts.guide.step1.title'],
      detail: defaultSettings['remoteHosts.guide.step1.detail'],
    },
    {
      title: defaultSettings['remoteHosts.guide.step2.title'],
      detail: defaultSettings['remoteHosts.guide.step2.detail'],
    },
    {
      title: defaultSettings['remoteHosts.guide.step3.title'],
      detail: defaultSettings['remoteHosts.guide.step3.detail'],
    },
  ],
  relayNote: defaultSettings['remoteHosts.guide.relayNote'],
  otherComputers: defaultSettings['remoteHosts.group.otherComputers'],
  otherComputersDescription: defaultSettings['remoteHosts.group.otherComputers.description'],
} satisfies RemoteHostsSettingsViewCopy

export const remoteHostsSettingsHosts = [
  {
    id: 'studio-mac',
    displayName: 'Studio Mac',
    enabled: true,
    lastSeenAt: 1_785_599_000,
    connectionConfigJson: JSON.stringify({
      transport: 'relay',
      relay: { roomId: 'room-studio', pinnedHostPubkey: 'host-key' },
    }),
    capabilitiesJson: JSON.stringify({
      cradleServer: { enabled: true, remoteHost: '127.0.0.1', remotePort: 21_423 },
    }),
    createdAt: 1_785_500_000,
    updatedAt: 1_785_599_000,
    connectionState: 'connected',
    lastError: null,
  },
  {
    id: 'linux-builder',
    displayName: 'Linux Builder',
    enabled: true,
    lastSeenAt: null,
    connectionConfigJson: JSON.stringify({
      transport: 'ssh',
      ssh: { hostName: 'builder.local', user: 'cradle' },
    }),
    capabilitiesJson: JSON.stringify({
      cradleServer: { enabled: true, remoteHost: '127.0.0.1', remotePort: 21_423 },
    }),
    createdAt: 1_785_500_000,
    updatedAt: 1_785_590_000,
    connectionState: 'offline',
    lastError: 'Connection timed out',
  },
] satisfies RemoteHostsSettingsHost[]
