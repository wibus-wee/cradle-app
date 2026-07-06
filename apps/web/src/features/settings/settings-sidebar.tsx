import {
  ArrowLeftLine as ArrowLeftIcon,
  ArrowToDownLine as ArrowDownToLineIcon,
  Box3Line as BoxesIcon,
  CloseLine as XIcon,
  Cursor2Line as MousePointer2Icon,
  CylinderLine as DatabaseIcon,
  Flag2Line as FlagIcon,
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
  SearchLine as SearchIcon,
  ServerLine as ServerIcon,
  WifiLine as WifiIcon,
} from '@mingcute/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

type SettingsKey = keyof typeof import('~/locales/default').default.settings

interface SettingsNavItem {
  id: string
  labelKey: SettingsKey
  icon: typeof PaletteIcon
  /** i18n keys for internal options that should be searchable */
  searchKeys?: SettingsKey[]
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
      { id: 'plugins', labelKey: 'nav.plugins', icon: PlugIcon },
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
  const [query, setQuery] = useState('')

  const normalizedQuery = query.trim().toLowerCase()

  const filteredSections = useMemo(() => {
    if (!normalizedQuery) { return SETTINGS_SECTIONS }

    return SETTINGS_SECTIONS.map((section) => {
      const sectionLabel = t(section.labelKey).toLowerCase()
      const sectionMatches = sectionLabel.includes(normalizedQuery)

      const matchedItems = section.items.filter((item) => {
        if (sectionMatches) { return true }

        const itemLabel = t(item.labelKey).toLowerCase()
        if (itemLabel.includes(normalizedQuery)) { return true }

        const keyMatch = item.labelKey.toLowerCase().includes(normalizedQuery)
        if (keyMatch) { return true }

        if (item.searchKeys) {
          return item.searchKeys.some((searchKey) => {
            const searchLabel = t(searchKey).toLowerCase()
            const searchKeyMatch = searchKey.toLowerCase().includes(normalizedQuery)
            return searchLabel.includes(normalizedQuery) || searchKeyMatch
          })
        }

        return false
      })

      return matchedItems.length > 0 ? { ...section, items: matchedItems } : null
    }).filter(Boolean) as SettingsSection[]
  }, [normalizedQuery, t])

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="settings-sidebar">
      {/* Back header */}
      <div className="flex items-center gap-1.5 px-3 py-2">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={t('sidebar.close')}
          data-testid="settings-close"
        >
          <ArrowLeftIcon aria-hidden="true" />
        </Button>
        <span className="text-xs font-medium text-foreground select-none">{t('sidebar.title')}</span>
      </div>

      {/* Search */}
      <div className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background/60 px-2 mx-2 mb-1 focus-within:border-ring/50 focus-within:ring-2 focus-within:ring-ring/15">
        <SearchIcon className="size-3.5 shrink-0 !text-muted-foreground/60" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('sidebar.search')}
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground/45"
          data-testid="settings-search"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 hover:bg-accent hover:text-foreground"
            aria-label={t('sidebar.clearSearch')}
          >
            <XIcon className="size-3" />
          </button>
        )}
      </div>

      {/* Sectioned nav */}
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pt-1 pb-2">
        {filteredSections.map(({ labelKey, items }) => (
          <div key={labelKey} className="flex flex-col gap-0.5">
            <span className="px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground select-none">
              {t(labelKey)}
            </span>
            {items.map(({ id, labelKey: itemLabelKey, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onSetSection(id)}
                data-testid={`settings-nav-${id}`}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs',
                  activeSection === id
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
                {t(itemLabelKey)}
              </button>
            ))}
          </div>
        ))}
        {normalizedQuery && filteredSections.length === 0 && (
          <div className="px-2.5 py-4 text-center text-xs text-muted-foreground">
            {t('sidebar.noResults')}
          </div>
        )}
      </nav>
    </div>
  )
}
