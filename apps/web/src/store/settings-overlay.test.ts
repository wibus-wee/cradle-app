import { beforeEach, describe, expect, it } from 'vitest'

import { useSettingsOverlayStore } from './settings-overlay'

describe('settings focus store', () => {
  beforeEach(() => {
    useSettingsOverlayStore.setState({
      settingsSection: 'appearance',
      chronicleFocusTarget: null,
      agentFocusTarget: null,
    })
  })

  it('stores and clears Chronicle focus targets', () => {
    useSettingsOverlayStore.getState().setChronicleFocusTarget({ type: 'memory', id: 'memory-1' })

    expect(useSettingsOverlayStore.getState().chronicleFocusTarget).toEqual({
      type: 'memory',
      id: 'memory-1',
    })

    useSettingsOverlayStore.getState().clearChronicleFocusTarget()

    expect(useSettingsOverlayStore.getState().chronicleFocusTarget).toBeNull()
  })

  it('stores and clears Agent focus targets', () => {
    useSettingsOverlayStore.getState().setAgentFocusTarget({ id: 'agent-1' })

    expect(useSettingsOverlayStore.getState().agentFocusTarget).toEqual({ id: 'agent-1' })

    useSettingsOverlayStore.getState().clearAgentFocusTarget()

    expect(useSettingsOverlayStore.getState().agentFocusTarget).toBeNull()
  })
})
