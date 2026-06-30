import { RouterProvider } from '@tanstack/react-router'

import { AppEnvironmentProviders } from '~/app-providers'
import { router } from '~/router'

export function App() {
  'use no memo'

  return (
    <AppEnvironmentProviders>
      <RouterProvider router={router} />
    </AppEnvironmentProviders>
  )
}
