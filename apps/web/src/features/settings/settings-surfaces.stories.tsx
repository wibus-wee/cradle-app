import {
  ChipLine as ChipIcon,
  GitBranchLine as GitBranchIcon,
  InformationLine as InfoIcon,
  Message1Line as MessageIcon,
  MonitorLine as MonitorIcon,
  PaletteLine as PaletteIcon,
  PluginLine as PluginIcon,
  RobotLine as RobotIcon,
  ServerLine as ServerIcon,
} from '@mingcute/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Switch } from '~/components/ui/switch'

import { SettingsGroup, SettingsPage } from './settings-container'
import { SettingsRow } from './settings-row'
import type { SettingsNavigationSection } from './settings-sidebar-view'
import { SettingsSidebarView } from './settings-sidebar-view'

const settingsSections: SettingsNavigationSection[] = [
  {
    id: 'general',
    label: 'General',
    items: [
      { id: 'appearance', label: 'Appearance', icon: PaletteIcon, searchTerms: ['theme', 'language'] },
      { id: 'desktop', label: 'Desktop', icon: MonitorIcon, searchTerms: ['updates', 'window'] },
    ],
  },
  {
    id: 'models',
    label: 'Models',
    items: [
      { id: 'providers', label: 'Providers', icon: PluginIcon, searchTerms: ['API keys', 'targets'] },
      { id: 'registry', label: 'Model registry', icon: ChipIcon, searchTerms: ['mapping', 'capabilities'] },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    items: [
      { id: 'agents', label: 'Agent profiles', icon: RobotIcon, searchTerms: ['instructions', 'skills'] },
      { id: 'chat', label: 'Chat', icon: MessageIcon, searchTerms: ['continuation', 'archive'] },
      { id: 'worktrees', label: 'Worktrees', icon: GitBranchIcon, searchTerms: ['cleanup', 'isolation'] },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { id: 'remote-hosts', label: 'Remote hosts', icon: ServerIcon, searchTerms: ['SSH', 'connection'] },
      { id: 'about', label: 'About', icon: InfoIcon, searchTerms: ['storage', 'version'] },
    ],
  },
]

function SettingsSurfacesGallery() {
  const [activeSection, setActiveSection] = useState('appearance')
  const [closed, setClosed] = useState(false)

  return (
    <main className="grid min-h-[48rem] grid-cols-1 bg-background text-foreground md:grid-cols-[17rem_1fr]">
      <aside className="min-h-96 border-b border-border bg-sidebar md:border-b-0 md:border-r">
        {closed
          ? (
              <div className="flex h-full items-center justify-center p-6">
                <Button variant="outline" size="sm" onClick={() => setClosed(false)}>Open settings navigation</Button>
              </div>
            )
          : (
              <SettingsSidebarView
                activeSection={activeSection}
                sections={settingsSections}
                title="Settings"
                searchPlaceholder="Search settings"
                closeLabel="Close settings"
                clearSearchLabel="Clear search"
                noResultsLabel="No settings found"
                onSetSection={setActiveSection}
                onClose={() => setClosed(true)}
              />
            )}
      </aside>
      <div className="min-w-0 overflow-y-auto px-5 py-8 sm:px-8">
        <SettingsPage
          title="Appearance"
          description="Tune the visual language and information density used across Cradle."
          action={<Badge variant="secondary">System</Badge>}
        >
          <SettingsGroup label="Theme" description="Applied immediately to every open surface.">
            <SettingsRow label="Color scheme" description="Follow the operating system or choose a fixed theme.">
              <div className="flex items-center gap-1 rounded-md bg-muted p-1">
                <Button variant="secondary" size="xs">System</Button>
                <Button variant="ghost" size="xs">Light</Button>
                <Button variant="ghost" size="xs">Dark</Button>
              </div>
            </SettingsRow>
            <SettingsRow label="Compact density" description="Reduce vertical padding in repeated operational lists.">
              <Switch aria-label="Compact density" />
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup label="Session previews">
            <SettingsRow
              label="Show latest message"
              description="Display a short preview beneath session titles."
              info="Preview text stays local to the current workspace."
            >
              <Switch defaultChecked aria-label="Show latest message" />
            </SettingsRow>
            <SettingsRow label="Preview length" description="Maximum characters shown in the sidebar.">
              <Input className="w-24" type="number" defaultValue="120" aria-label="Preview length" />
            </SettingsRow>
          </SettingsGroup>

          <SettingsGroup label="Component states" bare className="grid gap-3 p-4 sm:grid-cols-3">
            {[
              ['Default', 'Ready for interaction'],
              ['Loading', 'Waiting for runtime data'],
              ['Disabled', 'Unavailable in this context'],
            ].map(([label, description]) => (
              <div key={label} className="rounded-md border border-border p-3">
                <div className="text-sm font-medium">{label}</div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
              </div>
            ))}
          </SettingsGroup>
        </SettingsPage>
      </div>
    </main>
  )
}

const meta = {
  title: 'Settings/Surfaces',
  component: SettingsSurfacesGallery,
  parameters: {
    layout: 'fullscreen',
    controls: { disable: true },
  },
} satisfies Meta<typeof SettingsSurfacesGallery>

export default meta

type Story = StoryObj<typeof meta>

export const Catalog: Story = {}
