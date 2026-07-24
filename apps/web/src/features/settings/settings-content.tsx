import { AgentList } from '~/features/agent-management/agent-list'
import { AgentRuntimeSettings } from '~/features/agent-management/agent-runtime-settings'
import { RuntimesSettings } from '~/features/agent-runtimes/runtimes-settings'
import { ChronicleSettings } from '~/features/chronicle/chronicle-settings'
import { cn } from '~/lib/cn'

import { AboutSettings } from './about-settings'
import { AppearanceSettings } from './appearance-settings'
import { AwaitSettings } from './await-settings'
import { ChatSettings } from './chat-settings'
import { DesktopUpdateSettings } from './desktop-update-settings'
import { ExternalIssueSourceSettings } from './external-issue-source-settings'
import { ExternalWorkImportSettings } from './external-work-import-settings'
import { FeatureSettings } from './feature-settings'
import { IntegrationsSettings } from './integrations-settings'
import { JarvisSettings } from './jarvis-settings'
import { ModelRegistrySettings } from './model-registry-settings'
import { RemoteHostsSettings } from './remote-hosts-settings'
import { ServerEndpointSettings } from './server-endpoint-settings'
import { ShortcutSettings } from './shortcut-settings'
import { SupportSettings } from './support-settings'
import { WorktreeSettings } from './worktree-settings'

const SECTION_MAP: Record<string, React.ComponentType> = {
  appearance: AppearanceSettings,
  providers: AgentRuntimeSettings,
  registry: ModelRegistrySettings,
  agents: AgentList,
  runtimes: RuntimesSettings,
  chat: ChatSettings,
  await: AwaitSettings,
  worktrees: WorktreeSettings,
  jarvis: JarvisSettings,
  chronicle: ChronicleSettings,
  remoteHosts: RemoteHostsSettings,
  integrations: IntegrationsSettings,
  shortcut: ShortcutSettings,
  serverEndpoint: ServerEndpointSettings,
  network: ServerEndpointSettings,
  desktop: DesktopUpdateSettings,
  features: FeatureSettings,
  externalIssues: ExternalIssueSourceSettings,
  import: ExternalWorkImportSettings,
  support: SupportSettings,
  about: AboutSettings,
}

const FIXED_HEIGHT_SECTIONS = new Set(['import', 'providers', 'agents', 'runtimes', 'integrations'])

interface SettingsContentProps {
  section: string
}

export function SettingsContent({ section }: SettingsContentProps) {
  const activeSection = !import.meta.env.DEV && (section === 'chronicle' || section === 'externalIssues') ? 'appearance' : section
  const ActiveSection = SECTION_MAP[activeSection] ?? AppearanceSettings
  const fixedHeight = FIXED_HEIGHT_SECTIONS.has(activeSection)

  return (
    <div className="h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden">
      <div
        className={cn(
          'box-border h-full w-full min-w-0 px-8 pt-10',
          fixedHeight ? 'overflow-hidden' : 'overflow-y-auto pb-10',
        )}
      >
        <ActiveSection />
      </div>
    </div>
  )
}
