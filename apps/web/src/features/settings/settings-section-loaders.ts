import type { ComponentType } from 'react'

type SettingsSectionModule = { default: ComponentType }
type SettingsSectionLoader = () => Promise<SettingsSectionModule>

const loadServerEndpoint: SettingsSectionLoader = () => import('./server-endpoint-settings')
  .then(module => ({ default: module.ServerEndpointSettings }))

export const settingsSectionLoaders: Record<string, SettingsSectionLoader> = {
  appearance: () => import('./appearance-settings').then(module => ({ default: module.AppearanceSettings })),
  providers: () => import('~/features/agent-management/agent-runtime-settings').then(module => ({ default: module.AgentRuntimeSettings })),
  registry: () => import('./model-registry-settings').then(module => ({ default: module.ModelRegistrySettings })),
  agents: () => import('~/features/agent-management/agent-list').then(module => ({ default: module.AgentList })),
  runtimes: () => import('~/features/agent-runtimes/runtimes-settings').then(module => ({ default: module.RuntimesSettings })),
  chat: () => import('./chat-settings').then(module => ({ default: module.ChatSettings })),
  await: () => import('./await-settings').then(module => ({ default: module.AwaitSettings })),
  worktrees: () => import('./worktree-settings').then(module => ({ default: module.WorktreeSettings })),
  jarvis: () => import('./jarvis-settings').then(module => ({ default: module.JarvisSettings })),
  chronicle: () => import('~/features/chronicle/chronicle-settings').then(module => ({ default: module.ChronicleSettings })),
  remoteHosts: () => import('./remote-hosts-settings').then(module => ({ default: module.RemoteHostsSettings })),
  integrations: () => import('./integrations-settings').then(module => ({ default: module.IntegrationsSettings })),
  mcpServers: () => import('~/features/mcp-servers/mcp-servers-settings').then(module => ({ default: module.McpServersSettings })),
  shortcut: () => import('./shortcut-settings').then(module => ({ default: module.ShortcutSettings })),
  serverEndpoint: loadServerEndpoint,
  network: loadServerEndpoint,
  desktop: () => import('./desktop-update-settings').then(module => ({ default: module.DesktopUpdateSettings })),
  backup: () => import('./data-backup-settings').then(module => ({ default: module.DataBackupSettings })),
  downloads: () => import('~/features/managed-resources/managed-resources-page').then(module => ({ default: module.ManagedResourcesPage })),
  features: () => import('./feature-settings').then(module => ({ default: module.FeatureSettings })),
  externalIssues: () => import('./external-issue-source-settings').then(module => ({ default: module.ExternalIssueSourceSettings })),
  import: () => import('./external-work-import-settings').then(module => ({ default: module.ExternalWorkImportSettings })),
  support: () => import('./support-settings').then(module => ({ default: module.SupportSettings })),
  about: () => import('./about-settings').then(module => ({ default: module.AboutSettings })),
}

export function preloadSettingsSection(section: string): void {
  void settingsSectionLoaders[section]?.().catch(() => {})
}
