import { RouterProvider } from '@tanstack/react-router'

import { AppEnvironmentProviders } from '~/app-providers'
import { ActivityRuntime } from '~/features/activity/activity-runtime'
import { ProductAnalyticsRuntime } from '~/features/product-analytics/product-analytics-runtime'
import { router } from '~/router'

export function App() {
  'use no memo'

  return (
    <AppEnvironmentProviders>
      <ProductAnalyticsRuntime />
      <ActivityRuntime />
      <RouterProvider router={router} />
    </AppEnvironmentProviders>
  )
}
