import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NewWorkPageView } from './new-work-page-view'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(cleanup)

describe('new work page view', () => {
  it('offers a direct project picker when no workspace is available', () => {
    const onAddWorkspace = vi.fn()
    render(
      <NewWorkPageView
        composer={<div>Composer</div>}
        workspaceCount={0}
        loadingWorkspaces={false}
        addingWorkspace={false}
        failureKind={null}
        failureMessage={null}
        canOpenChanges={false}
        onOpenChanges={() => {}}
        onAddWorkspace={onAddWorkspace}
        onDismissFailure={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'new.addProject' }))

    expect(onAddWorkspace).toHaveBeenCalledOnce()
  })
})
