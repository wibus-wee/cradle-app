import { createFileRoute } from '@tanstack/react-router'

import { DevtoolPage } from '~/features/devtool/ipc-devtool-page'

export const Route = createFileRoute('/devtool')({
  component: DevtoolPage,
})
