import { describe, expect, it } from 'vitest'

import {
  getRuntimeRegistry,
  listRuntimeCatalog,
} from '../src/modules/chat-runtime/chat-runtime-provider-registry'

describe('runtime catalog', () => {
  it('exposes CLI TUI as a catalog-only chat launch runtime', () => {
    const catalog = listRuntimeCatalog()
    const cliTuiItems = catalog.filter(item => item.runtimeKind === 'cli-tui')

    expect(cliTuiItems).toHaveLength(1)
    expect(cliTuiItems[0]).toMatchObject({
      runtimeKind: 'cli-tui',
      label: 'CLI TUI',
      description: 'Launch a configured terminal agent',
      providerKinds: [],
      providerBinding: 'runtime-owned',
      sessionLaunchMode: 'agent-terminal',
      iconKey: 'claude-cli',
      surfaces: ['chat'],
      source: 'builtin',
      pluginOwner: null,
    })
    expect(getRuntimeRegistry().get('cli-tui')).toBeUndefined()
  })
})
