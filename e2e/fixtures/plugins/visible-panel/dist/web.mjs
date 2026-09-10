import { createElement } from 'react'

function LifecyclePanel() {
  return createElement(
    'main',
    { 'data-testid': 'e2e-plugin-lifecycle-panel' },
    createElement('h1', null, 'Plugin lifecycle is active'),
  )
}

export function activate(ctx) {
  ctx.panels.register({
    id: 'lifecycle',
    title: 'E2E Lifecycle',
    component: LifecyclePanel,
    location: 'sidebar',
  })
}
