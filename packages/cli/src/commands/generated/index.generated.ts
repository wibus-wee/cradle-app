import type { Command } from 'commander'

export const generatedCommandGroups = ["acp", "agent", "automation", "background-activity", "background-job", "board", "chat", "chronicle", "codex", "download-center", "external-issue-source", "external-session-import", "health", "issue", "issue-agent-session", "kimi", "link-preview", "managed-resources", "mcp-server", "observability", "opencode", "plugin", "preferences", "profile", "provider", "pull-request", "search", "secret", "session", "session-group", "skill", "usage", "work", "workflow-rule", "workspace"] as const

const groupLoaders: Record<string, () => Promise<{ registerGeneratedCommands: (program: Command) => void }>> = {
  "acp": () => import('./groups.generated/acp'),
  "agent": () => import('./groups.generated/agent'),
  "automation": () => import('./groups.generated/automation'),
  "background-activity": () => import('./groups.generated/background-activity'),
  "background-job": () => import('./groups.generated/background-job'),
  "board": () => import('./groups.generated/board'),
  "chat": () => import('./groups.generated/chat'),
  "chronicle": () => import('./groups.generated/chronicle'),
  "codex": () => import('./groups.generated/codex'),
  "download-center": () => import('./groups.generated/download-center'),
  "external-issue-source": () => import('./groups.generated/external-issue-source'),
  "external-session-import": () => import('./groups.generated/external-session-import'),
  "health": () => import('./groups.generated/health'),
  "issue": () => import('./groups.generated/issue'),
  "issue-agent-session": () => import('./groups.generated/issue-agent-session'),
  "kimi": () => import('./groups.generated/kimi'),
  "link-preview": () => import('./groups.generated/link-preview'),
  "managed-resources": () => import('./groups.generated/managed-resources'),
  "mcp-server": () => import('./groups.generated/mcp-server'),
  "observability": () => import('./groups.generated/observability'),
  "opencode": () => import('./groups.generated/opencode'),
  "plugin": () => import('./groups.generated/plugin'),
  "preferences": () => import('./groups.generated/preferences'),
  "profile": () => import('./groups.generated/profile'),
  "provider": () => import('./groups.generated/provider'),
  "pull-request": () => import('./groups.generated/pull-request'),
  "search": () => import('./groups.generated/search'),
  "secret": () => import('./groups.generated/secret'),
  "session": () => import('./groups.generated/session'),
  "session-group": () => import('./groups.generated/session-group'),
  "skill": () => import('./groups.generated/skill'),
  "usage": () => import('./groups.generated/usage'),
  "work": () => import('./groups.generated/work'),
  "workflow-rule": () => import('./groups.generated/workflow-rule'),
  "workspace": () => import('./groups.generated/workspace'),
}

const groupDescriptions: Record<string, string> = {
  "acp": "Manage ACP agent installation and registry state.",
  "agent": "Manage Cradle agent identities.",
  "automation": "Manage scheduled automations, runs, and artifacts.",
  "background-activity": "Manage background-activity commands.",
  "background-job": "Manage background-job commands.",
  "board": "Manage Kanban boards.",
  "chat": "Control chat runtime commands.",
  "chronicle": "Manage chronicle commands.",
  "codex": "Manage codex commands.",
  "download-center": "Manage download-center commands.",
  "external-issue-source": "Manage external-issue-source commands.",
  "external-session-import": "Manage external-session-import commands.",
  "health": "Check server health.",
  "issue": "Manage Kanban issues, comments, relations, delegation, and context refs.",
  "issue-agent-session": "Inspect and control issue agent sessions.",
  "kimi": "Manage kimi commands.",
  "link-preview": "Manage link-preview commands.",
  "managed-resources": "Manage managed-resources commands.",
  "mcp-server": "Manage mcp-server commands.",
  "observability": "Inspect local observability events, incidents, and exports.",
  "opencode": "Manage opencode commands.",
  "plugin": "Manage plugin commands.",
  "preferences": "Read and update server preferences.",
  "profile": "Manage agent profiles.",
  "provider": "Inspect provider model availability.",
  "pull-request": "Manage pull-request commands.",
  "search": "Search Cradle data.",
  "secret": "Manage secret metadata.",
  "session": "Manage chat sessions and session links.",
  "session-group": "Manage session-group commands.",
  "skill": "Manage skills and skill sources.",
  "usage": "Inspect usage and cost data.",
  "work": "Manage user-controlled local Work containers and Draft PR delivery.",
  "workflow-rule": "Manage workflow rules.",
  "workspace": "Manage workspaces, files, and git helpers.",
}

export async function registerGeneratedCommandGroup(program: Command, group: string | undefined): Promise<void> {
  if (!group) { return }
  const load = groupLoaders[group]
  if (!load) { return }
  const module = await load()
  module.registerGeneratedCommands(program)
}

export function registerGeneratedCommandPlaceholders(program: Command, loadedGroup: string | undefined): void {
  for (const group of generatedCommandGroups) {
    if (group === loadedGroup || program.commands.some(command => command.name() === group)) { continue }
    program.command(group).description(groupDescriptions[group] ?? `Manage ${group} commands.`)
  }
}
