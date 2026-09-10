import { createElement } from 'react'

function PersonalPanel() {
  return createElement('main', { 'data-testid': 'e2e-personal-plugin-panel' }, 'Personal Plugin revision v2')
}

export function activate(ctx) {
  ctx.panels.register({
    id: 'personal-lifecycle',
    title: 'E2E Personal Plugin',
    component: PersonalPanel,
    location: 'sidebar',
  })
}
