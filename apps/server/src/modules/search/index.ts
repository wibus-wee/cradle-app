import { Elysia } from 'elysia'

import { searchChronicle } from './chronicle-search.engine'
import { SearchModel } from './model'
import * as Search from './service'

export const search = new Elysia({
  prefix: '/search',
  detail: { tags: ['search'] },
})
  .get('/threads', ({ query }) => Search.searchThreads({
    query: query.query,
    workspaceId: query.workspaceId,
    origin: query.origin,
    limit: query.limit,
    snippetsPerHit: query.snippetsPerHit,
  }), {
    detail: {
      'summary': 'Search threads',
      'x-cradle-cli': {
        command: ['search', 'threads'],
      },
    },
    query: SearchModel.searchQuery,
    response: { 200: SearchModel.threadSearchResponse },
  })
  .get('/chronicle', ({ query }) => searchChronicle({
    query: query.query,
    workspaceId: query.workspaceId,
    limit: query.limit,
  }), {
    detail: {
      'summary': 'Search Chronicle memories and knowledge',
      'x-cradle-cli': {
        command: ['search', 'chronicle'],
      },
    },
    query: SearchModel.chronicleSearchQuery,
    response: { 200: SearchModel.chronicleSearchResponse },
  })
