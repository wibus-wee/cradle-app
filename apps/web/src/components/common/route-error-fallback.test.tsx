import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '~/i18n/client'

import { RouteErrorFallback } from './route-error-fallback'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('routeErrorFallback', () => {
  it('renders a route-scoped fallback while the parent shell stays mounted', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const rootRoute = createRootRoute({
      component: TestShell,
    })
    const throwingRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: ThrowingPane,
      errorComponent: RouteErrorFallback,
    })
    const routeTree = rootRoute.addChildren([throwingRoute])
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ['/'] }),
      defaultErrorComponent: RouteErrorFallback,
    })

    render(
      <I18nProvider initialLocale="en-US">
        <RouterProvider router={router} />
      </I18nProvider>,
    )

    expect(await screen.findByText('This pane hit an error')).not.toBeNull()
    expect(screen.getByText('Shell stays mounted')).not.toBeNull()
    expect(screen.getByText('Route pane exploded')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Back to home' })).not.toBeNull()
  })
})

function TestShell() {
  return (
    <div>
      <p>Shell stays mounted</p>
      <Outlet />
    </div>
  )
}

function ThrowingPane() {
  throw new Error('Route pane exploded')
}
