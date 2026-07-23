import {
  ArrowToDownLine as ArrowDownToLineIcon,
  Box3Line as BoxesIcon,
  ChipLine as ChipIcon,
  Cursor2Line as MousePointer2Icon,
  CylinderLine as DatabaseIcon,
  Flag2Line as FlagIcon,
  GiftLine as GiftIcon,
  GitBranchLine as GitBranchIcon,
  HeartbeatLine as ActivityIcon,
  InformationLine as InfoIcon,
  KeyboardLine as KeyboardIcon,
  LifebuoyLine as LifeBuoyIcon,
  Link3Line as LinkIcon,
  Message1Line as MessageSquareIcon,
  MonitorLine as MonitorIcon,
  PaletteLine as PaletteIcon,
  PluginLine as PlugIcon,
  RobotLine as BotIcon,
  SandglassLine as HourglassIcon,
  ServerLine as ServerIcon,
  WifiLine as WifiIcon,
} from '@mingcute/react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { openWhatsNewDialog } from '~/features/changelog/whats-new-store'
import { cn } from '~/lib/cn'
import { openPluginCenter } from '~/navigation/navigation-commands'

import type { SettingsNavigationSection } from './settings-sidebar-view'
import { SettingsSidebarView } from './settings-sidebar-view'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

interface SettingsNavItem {
  id: string
  labelKey: SettingsKey
  icon: typeof PaletteIcon
  /** i18n keys for internal options that should be searchable */
  searchKeys?: SettingsKey[]
  /**
   * Optional override: if set, clicking this item opens a different surface
   * (e.g. the Plugin Center) instead of switching the settings overlay section.
   */
  onActivate?: () => void
}

interface SettingsSection {
  labelKey: SettingsKey
  items: SettingsNavItem[]
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    labelKey: 'sidebar.section.general',
    items: [
      {
        id: 'appearance',
        labelKey: 'nav.appearance',
        icon: PaletteIcon,
        searchKeys: [
          'appearance.theme.label',
          'appearance.language.label',
          'appearance.sessionPreview.label',
        ],
      },
      {
        id: 'desktop',
        labelKey: 'nav.desktop',
        icon: MonitorIcon,
        searchKeys: [
          'desktop.doubleCommandQ.label',
          'desktop.autoCheckForUpdates.label',
          'desktop.autoDownloadUpdates.label',
          'desktop.cli.title',
          'desktop.updates.title',
        ],
      },
      {
        id: 'shortcut',
        labelKey: 'nav.shortcut',
        icon: KeyboardIcon,
        searchKeys: [
          'shortcut.appshotHotkey.label',
          'shortcut.builtIn.settings.label',
          'shortcut.builtIn.commandPalette.label',
          'shortcut.builtIn.quickOpen.label',
          'shortcut.builtIn.newChat.label',
          'shortcut.builtIn.jarvis.label',
        ],
      },
    ],
  },
  {
    labelKey: 'sidebar.section.models',
    items: [
      { id: 'providers', labelKey: 'nav.providers', icon: PlugIcon },
      {
        id: 'registry',
        labelKey: 'nav.registry',
        icon: DatabaseIcon,
        searchKeys: [
          'registry.add.label',
          'registry.field.modelId',
          'registry.field.registryModelId',
        ],
      },
    ],
  },
  {
    labelKey: 'sidebar.section.agent',
    items: [
      { id: 'agents', labelKey: 'nav.agents', icon: BotIcon },
      { id: 'runtimes', labelKey: 'nav.runtimes', icon: ChipIcon },
      {
        id: 'chat',
        labelKey: 'nav.chat',
        icon: MessageSquareIcon,
        searchKeys: [
          'chat.continuation.label',
          'chat.titleGeneration.label',
          'chat.archive.label',
          'chat.codexUserAgent.label',
        ],
      },
      {
        id: 'await',
        labelKey: 'nav.await',
        icon: HourglassIcon,
        searchKeys: [
          'await.rules.label',
          'await.workspace.label',
        ],
      },
      {
        id: 'worktrees',
        labelKey: 'nav.worktrees',
        icon: GitBranchIcon,
        searchKeys: [
          'worktrees.cleanup.maxWorktrees.label',
          'worktrees.cleanup.maxTotalSizeGb.label',
          'worktrees.list.title',
        ],
      },
      {
        id: 'jarvis',
        labelKey: 'nav.jarvis',
        icon: MousePointer2Icon,
        searchKeys: [
          'jarvis.model.label',
          'jarvis.runtime.label',
          'jarvis.thinking.medium.label',
        ],
      },
    ],
  },
  {
    labelKey: 'sidebar.section.extensions',
    items: [
      { id: 'plugins', labelKey: 'nav.plugins', icon: PlugIcon, onActivate: openPluginCenter },
      {
        id: 'integrations',
        labelKey: 'nav.integrations',
        icon: LinkIcon,
        searchKeys: [
          'integrations.tabs.connections',
          'integrations.slack.title',
          'integrations.channelBindings.title',
          'integrations.secrets.title',
        ],
      },
    ],
  },
  {
    labelKey: 'sidebar.section.system',
    items: [
      {
        id: 'serverEndpoint',
        labelKey: 'nav.network',
        icon: WifiIcon,
        searchKeys: [
          'serverEndpoint.url.label',
          'serverEndpoint.action.test',
          'serverEndpoint.externalGuide.label',
          'network.enabled.label',
          'network.mode.system.label',
          'network.mode.custom.label',
          'network.custom.url.label',
        ],
      },
      {
        id: 'features',
        labelKey: 'nav.features',
        icon: FlagIcon,
        searchKeys: [
          'features.multiWorkspace.label',
          'features.nativeProviderSkillProjection.label',
          'features.localAuthForDangerousActions.label',
        ],
      },
      {
        id: 'remoteHosts',
        labelKey: 'nav.remoteHosts',
        icon: ServerIcon,
        searchKeys: ['remoteHosts.form.sshTarget' as SettingsKey, 'remoteHosts.form.displayName' as SettingsKey],
      },
      ...(import.meta.env.DEV
        ? [{ id: 'chronicle', labelKey: 'nav.chronicle', icon: ActivityIcon } satisfies SettingsNavItem]
        : []),
      ...(import.meta.env.DEV
        ? [{ id: 'externalIssues', labelKey: 'nav.externalIssues', icon: BoxesIcon } satisfies SettingsNavItem]
        : []),
      {
        id: 'import',
        labelKey: 'nav.import',
        icon: ArrowDownToLineIcon,
        searchKeys: [
          'import.action.import',
          'import.action.scan',
        ],
      },
    ],
  },
  {
    labelKey: 'sidebar.section.help',
    items: [
      {
        id: 'support',
        labelKey: 'nav.support',
        icon: LifeBuoyIcon,
        searchKeys: [
          'support.diagnostics.label',
          'support.feedbackTemplate.label',
          'support.onboarding.label',
          'support.uninstall.label',
        ],
      },
      {
        id: 'about',
        labelKey: 'nav.about',
        icon: InfoIcon,
        searchKeys: [
          'about.storage.database.label',
          'about.storage.applicationSupport.label',
        ],
      },
      {
        id: 'whatsNew',
        labelKey: 'nav.whatsNew',
        icon: GiftIcon,
        onActivate: () => openWhatsNewDialog(),
      },
    ],
  },
]

interface SettingsSidebarProps {
  activeSection: string
  onSetSection: (section: string) => void
  onClose: () => void
}

export function SettingsSidebar({ activeSection, onSetSection, onClose }: SettingsSidebarProps) {
  const { t } = useTranslation('settings')
  const sections = useMemo<SettingsNavigationSection[]>(() => {
    return SETTINGS_SECTIONS.map(section => ({
      id: section.labelKey,
      label: t(section.labelKey),
      items: section.items.map(item => ({
        id: item.id,
        label: t(item.labelKey),
        icon: item.icon,
        onActivate: item.onActivate,
        searchTerms: [
          item.labelKey,
          ...(item.searchKeys ?? []),
          ...(item.searchKeys ?? []).map(searchKey => t(searchKey)),
        ],
      })),
    }))
  }, [t])

  return (
    <SettingsSidebarView
      activeSection={activeSection}
      sections={sections}
      title={t('sidebar.title')}
      searchPlaceholder={t('sidebar.search')}
      closeLabel={t('sidebar.close')}
      clearSearchLabel={t('sidebar.clearSearch')}
      noResultsLabel={t('sidebar.noResults')}
      onSetSection={onSetSection}
      onClose={onClose}
    />
  )
}
