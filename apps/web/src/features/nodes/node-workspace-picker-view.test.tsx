import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '~/i18n/client'

import type { NodeWorkspacePickerState } from './node-workspace-picker-view'
import { NodeWorkspacePickerView } from './node-workspace-picker-view'

afterEach(cleanup)

function renderPicker(state: NodeWorkspacePickerState) {
  return render(
    <I18nProvider initialLocale="en-US">
      <NodeWorkspacePickerView
        entries={[]}
        state={state}
        addingTargetKey={null}
        onRetry={vi.fn()}
        onAddWorkspace={vi.fn()}
      />
    </I18nProvider>,
  )
}

describe('node workspace picker view', () => {
  it.each([
    ['connecting', 'node-workspace-connecting'],
    ['offline', 'node-workspace-offline'],
    ['access-denied', 'node-workspace-access-denied'],
    ['error', 'node-workspace-connection-error'],
  ] as const)('does not report a failed %s inventory as empty', async (state, testId) => {
    renderPicker(state)

    expect(await screen.findByTestId(testId)).not.toBeNull()
    expect(screen.queryByTestId('node-workspace-empty')).toBeNull()
  })

  it('reports an empty inventory only after a successful response', async () => {
    renderPicker('ready')

    expect(await screen.findByTestId('node-workspace-empty')).not.toBeNull()
  })
})
