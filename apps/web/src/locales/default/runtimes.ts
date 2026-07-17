export default {
  // Page header
  'page.title': 'Runtimes',
  'page.description': 'Browse built-in runtimes and install agents from the ACP Registry.',

  // List pane
  'search.placeholder': 'Search runtimes…',
  'search.clear': 'Clear search',
  'filter.all': 'All',
  'filter.installed': 'Installed',
  'filter.updates': 'Updates',
  'group.builtin': 'Built-in',
  'group.acpRegistry': 'ACP Registry',

  // Chips
  'chip.builtin': 'Built-in',
  'chip.agent': 'Agent',
  'chip.experimental': 'Experimental',

  // Empty / error states
  'empty.noSelection': 'Select a runtime to see details',
  'empty.search.title': 'No matching runtimes',
  'empty.search.description': 'Try a different search term or clear the search.',
  'empty.search.clear': 'Clear search',
  'error.registry.title': 'Could not load the ACP Registry',
  'error.registry.description': 'Check your connection, then try again.',
  'error.retry': 'Retry',

  // Detail pane (shared)
  'detail.versionChip': 'v{{version}}',
  'detail.links.repository': 'Repository',
  'detail.links.website': 'Website',
  'detail.action.createAgent': 'Create agent',
  'detail.usedBy.title': 'Used by',

  // Detail pane (ACP)
  'detail.action.install': 'Install',
  'detail.action.installWith': 'Install with {{type}}',
  'detail.action.installing': 'Installing…',
  'detail.action.cancel': 'Cancel',
  'detail.action.uninstall': 'Uninstall',
  'detail.action.update': 'Update',
  'detail.action.retry': 'Retry',
  'detail.installedLine': 'Installed · v{{version}} · {{distributionType}}',
  'detail.installFailed': 'Installation failed. Try again.',

  // Uninstall dialog
  'uninstall.title': 'Uninstall {{name}}?',
  'uninstall.description': 'The ACP agent is removed from this device. Agents bound to it keep their configuration but can no longer run.',
  'uninstall.inUse_one': '{{count}} agent currently uses this runtime.',
  'uninstall.inUse_many': '{{count}} agents currently use this runtime.',
  'uninstall.inUse_other': '{{count}} agents currently use this runtime.',
  'uninstall.confirm': 'Uninstall',
  'uninstall.cancel': 'Cancel',

  // Toasts
  'toast.installError': 'Could not install {{name}}',
  'toast.cancelError': 'Could not cancel the installation',
  'toast.uninstallError': 'Could not uninstall {{name}}',

  // Built-in detail pane
  'builtin.provider.required': 'Requires a model provider',
  'builtin.provider.runtimeOwned': 'Manages its own providers',
  'builtin.provider.none': 'No provider needed — brings its own models and credentials',
  'builtin.capabilities.title': 'Capabilities',
  'builtin.degradations.title': 'Known limitations',
  'capability.steer': 'Steer mid-run',
  'capability.sessionModelSwitch': 'Model switch in session',
  'capability.supportsShellExecution': 'Shell execution',
  'capability.supportsLastTurnRollback': 'Last-turn rollback',
  'capability.supportsRuntimeSettings': 'Runtime settings',
  'capability.supportsTitleGeneration': 'Title generation',
  'capability.value.supported': 'Supported',
  'capability.value.unsupported': 'Unsupported',
  'capability.value.native': 'Native',
  'capability.value.queueFallback': 'Queue fallback',
  'capability.value.inSession': 'In-session',
  'capability.value.restartSession': 'Requires restart',
  'degradation.status.unsupported': 'Unsupported',
  'degradation.status.partial': 'Partial',
  'degradation.status.experimental': 'Experimental',
  'degradation.capability.runtime': 'Runtime',
  'degradation.capability.lastTurnRollback': 'Last-turn rollback',
  'degradation.capability.runtimeSettings': 'Runtime settings',
  'degradation.capability.steer': 'Steer',
}
