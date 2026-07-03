export default {
  'placeholder.task': 'Describe the task you want the agent to do in this project...',
  'placeholder.structure': 'Explain the codebase structure and where to begin...',
  'placeholder.risk': 'Find risky changes and suggest the safest next step...',
  'placeholder.fixTest': 'Fix a failing test and explain the root cause...',
  'placeholder.refactor': 'Plan a refactor before editing implementation code...',
  'quick.explain.label': 'Explain this codebase',
  'quick.explain.prompt':
    'Explain this codebase from the perspective of a new contributor. Focus on architecture, key modules, data flow, and where I should start.',
  'quick.risk.label': 'Find risky changes',
  'quick.risk.prompt':
    'Inspect the recent changes in this project and identify risky areas, likely regressions, and the smallest verification plan.',
  'quick.fixTest.label': 'Fix a failing test',
  'quick.fixTest.prompt':
    'Find the failing test in this project, explain the root cause, and make the smallest maintainable fix.',
  'quick.notes.label': 'Write project notes',
  'quick.notes.prompt':
    'Read the project context and write concise project notes that capture architecture, conventions, and important workflows.',
  'quick.refactor.label': 'Plan a refactor',
  'quick.refactor.prompt':
    'Plan a focused refactor for this project. Identify the boundary, risks, migration steps, and tests before editing code.',
  'relative.justNow': 'just now',
  'relative.minutesAgo': '{{count}} minutes ago',
  'relative.hoursAgo': '{{count}} hours ago',
  'relative.daysAgo': '{{count}} days ago',
  'relative.monthsAgo': '{{count}} months ago',
  'readiness.agent.message':
    'No Agent is available. Enable an Agent in settings to start.',
  'readiness.agent.action': 'Open agents',
  'readiness.provider.message':
    'No provider is available. Configure a provider before sending the first message.',
  'readiness.provider.action': 'Open providers',
  'workspace.adhoc': 'No project',
  'workspace.addProject': 'Add project',
  'workspace.adding': 'Adding...',
  'workspace.group': 'Workspaces',
  'send.tooltip': 'Send',
  'send.inWorktree': 'Send in worktree',
  'isolatedAction': 'New isolated chat',
  'isolatedActionTooltip': 'Create a session in an isolated git worktree',
  'isolatedDefaultTitle': 'Isolated chat',
  'isolatedStartError': 'Could not start isolated chat',
  'isolatedProviderRequired': 'Select an agent or provider first',
  'recent.title': 'Recent chats',
  'recent.untitled': 'Untitled',
} as const
