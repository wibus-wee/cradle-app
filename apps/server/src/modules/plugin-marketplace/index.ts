import { Elysia } from 'elysia'

import { MarketplaceModel } from './model'
import * as Marketplace from './service'

/**
 * Marketplace routes, mounted under the existing `/plugins` prefix by
 * `modules/plugins/index.ts` (which `.use()`s this fragment). Kept prefix-less
 * here so the parent instance's `/plugins` prefix applies, avoiding a
 * `/plugins/plugins/marketplace` double-prefix.
 */
export const pluginMarketplaceRoutes = new Elysia({
  detail: { tags: ['plugins'] },
})
  .get('/marketplace', () => Marketplace.listMarketplace(), {
    detail: {
      'summary': 'List marketplace plugin catalog',
      'x-cradle-cli': {
        command: ['plugin', 'marketplace', 'list'],
      },
    },
    response: { 200: MarketplaceModel.marketplaceResponse },
  })
  .post('/marketplace/refresh', () => Marketplace.refreshMarketplace(), {
    detail: {
      'summary': 'Force-refresh marketplace catalog',
      'x-cradle-cli': {
        command: ['plugin', 'marketplace', 'refresh'],
      },
    },
    response: { 200: MarketplaceModel.marketplaceResponse },
  })
