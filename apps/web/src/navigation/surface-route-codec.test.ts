import { describe, expect, it } from 'vitest'

import type { SurfaceKind, SurfaceRoute } from './surface-route-codec'
import {
  isSurfaceKindPersistable,
  parseSurfaceRoute,
  persistedSurfaceSchema,
  SURFACE_KIND_BY_ROUTE_TO,
  SURFACE_KINDS,
  surfaceIdForRoute,
  surfaceKindForRoute,
  surfaceRouteFromLocation,
  surfaceRouteNavigateOptions,
} from './surface-route-codec'

/**
 * One row per surface route: the canonical route instance plus the raw
 * location the router would report for it. The matrix is exhaustive — adding
 * a route without a row fails the coverage assertions below.
 */
const ROUTE_MATRIX: Array<{
  route: SurfaceRoute
  kind: SurfaceKind
  id: string
  pathname: string
  params?: Record<string, unknown>
  search?: Record<string, unknown>
}> = [
  { route: { to: '/' }, kind: 'home', id: 'home', pathname: '/' },
  {
    route: { to: '/work/new', search: { workspaceId: 'ws-1', issueId: 'issue-1' } },
    kind: 'new-work',
    id: 'new-work',
    pathname: '/work/new',
    search: { workspaceId: 'ws-1', issueId: 'issue-1' },
  },
  {
    route: { to: '/work/$workId', params: { workId: 'work-1' } },
    kind: 'work',
    id: 'work:work-1',
    pathname: '/work/work-1',
    params: { workId: 'work-1' },
  },
  {
    route: { to: '/pull-requests', search: { pr: 'cradle/app#42' } },
    kind: 'pull-requests',
    id: 'pull-requests',
    pathname: '/pull-requests',
    search: { pr: 'cradle/app#42' },
  },
  {
    route: {
      to: '/chat/new',
      search: { issueId: 'issue-1', workspaceId: 'ws-1', sessionGroupId: 'group-1' },
    },
    kind: 'new-chat',
    id: 'new-chat',
    pathname: '/chat/new',
    search: { issueId: 'issue-1', workspaceId: 'ws-1', sessionGroupId: 'group-1' },
  },
  {
    route: { to: '/chat/$sessionId', params: { sessionId: 'session-1' } },
    kind: 'chat',
    id: 'chat:session-1',
    pathname: '/chat/session-1',
    params: { sessionId: 'session-1' },
  },
  {
    route: {
      to: '/diff',
      search: {
        workspace: 'ws-1',
        repo: '/repo',
        path: 'src/a.ts',
        review: 'rev-1',
        line: 12,
        side: 'head',
        github: 'pull/42',
      },
    },
    kind: 'diff',
    id: 'diff',
    pathname: '/diff',
    search: {
      workspace: 'ws-1',
      repo: '/repo',
      path: 'src/a.ts',
      review: 'rev-1',
      line: 12,
      side: 'head',
      github: 'pull/42',
    },
  },
  {
    route: { to: '/workspaces/$workspaceId', params: { workspaceId: 'ws-1' } },
    kind: 'workspace',
    id: 'workspace:ws-1',
    pathname: '/workspaces/ws-1',
    params: { workspaceId: 'ws-1' },
  },
  {
    route: {
      to: '/workspaces/$workspaceId/diffs',
      params: { workspaceId: 'ws-1' },
      search: { repo: '/repo', path: 'src/a.ts', review: 'rev-1', line: 4, side: 'base' },
    },
    kind: 'workspace-diffs',
    id: 'workspace-diffs:ws-1',
    pathname: '/workspaces/ws-1/diffs',
    params: { workspaceId: 'ws-1' },
    search: { repo: '/repo', path: 'src/a.ts', review: 'rev-1', line: 4, side: 'base' },
  },
  {
    route: { to: '/kanban/$boardId', params: { boardId: 'board-1' }, search: { issue: 'i-1', milestoneId: 'm-1' } },
    kind: 'kanban',
    id: 'kanban:board-1',
    pathname: '/kanban/board-1',
    params: { boardId: 'board-1' },
    search: { issue: 'i-1', milestoneId: 'm-1' },
  },
  {
    route: { to: '/plugins/$routeSegment/$localId', params: { routeSegment: 'browser', localId: 'tab-1' } },
    kind: 'plugin',
    id: 'plugin:browser:tab-1',
    pathname: '/plugins/browser/tab-1',
    params: { routeSegment: 'browser', localId: 'tab-1' },
  },
  { route: { to: '/plugins' }, kind: 'plugin-center', id: 'plugin-center', pathname: '/plugins' },
  { route: { to: '/awaits' }, kind: 'awaits', id: 'awaits', pathname: '/awaits' },
  { route: { to: '/automation' }, kind: 'automation', id: 'automation', pathname: '/automation' },
  { route: { to: '/usage' }, kind: 'usage', id: 'usage', pathname: '/usage' },
  {
    route: { to: '/settings/$section', params: { section: 'appearance' } },
    kind: 'settings',
    id: 'settings',
    pathname: '/settings/appearance',
    params: { section: 'appearance' },
  },
  { route: { to: '/onboarding' }, kind: 'onboarding', id: 'onboarding', pathname: '/onboarding' },
  { route: { to: '/devtool' }, kind: 'devtool', id: 'devtool', pathname: '/devtool' },
]

describe('surface route codec', () => {
  it('covers every declared surface route exactly once', () => {
    expect(ROUTE_MATRIX.map(row => row.route.to).sort()).toEqual(
      Object.keys(SURFACE_KIND_BY_ROUTE_TO).sort(),
    )
    expect(new Set(Object.values(SURFACE_KIND_BY_ROUTE_TO))).toEqual(new Set(SURFACE_KINDS))
  })

  it('decodes every router location to its canonical route', () => {
    for (const row of ROUTE_MATRIX) {
      const decoded = surfaceRouteFromLocation({
        pathname: row.pathname,
        params: row.params,
        search: row.search,
      })
      expect(decoded, row.route.to).toEqual(row.route)
      expect(surfaceKindForRoute(decoded!)).toBe(row.kind)
      expect(surfaceIdForRoute(decoded!)).toBe(row.id)
    }
  })

  it('round-trips every route through the untrusted decode boundary', () => {
    for (const row of ROUTE_MATRIX) {
      expect(parseSurfaceRoute(JSON.parse(JSON.stringify(row.route))), row.route.to)
        .toEqual(row.route)
    }
  })

  it('encodes every route to navigate options with its own params/search', () => {
    for (const row of ROUTE_MATRIX) {
      const options = surfaceRouteNavigateOptions(row.route, { replace: true })
      expect(options.to).toBe(row.route.to)
      expect('params' in options ? options.params : undefined)
        .toEqual(row.route.params ?? (row.params ? row.params : undefined))
      expect('search' in options ? options.search : undefined)
        .toEqual(row.route.search ?? (row.search ? row.search : undefined))
      expect(options.replace).toBe(true)
    }
  })

  it('normalizes /home and trailing slashes to the home route', () => {
    expect(surfaceRouteFromLocation({ pathname: '/home' })).toEqual({ to: '/' })
    expect(surfaceRouteFromLocation({ pathname: '/chat/new/' }))
      .toEqual({ to: '/chat/new', search: undefined })
  })

  it('decodes path params from the pathname when the router has none', () => {
    expect(surfaceRouteFromLocation({ pathname: '/chat/session-9' })).toEqual({
      to: '/chat/$sessionId',
      params: { sessionId: 'session-9' },
      search: undefined,
    })
  })

  it('preserves New Chat workspace and session-group context', () => {
    const route = parseSurfaceRoute({
      to: '/chat/new',
      search: { workspaceId: 'ws-1', sessionGroupId: 'group-1' },
    })
    expect(route).toEqual({
      to: '/chat/new',
      search: { workspaceId: 'ws-1', sessionGroupId: 'group-1' },
    })
  })

  it('preserves diff anchors, coercing serialized line numbers', () => {
    const route = surfaceRouteFromLocation({
      pathname: '/diff',
      search: { review: 'rev-1', line: '42', side: 'base' },
    })
    expect(route).toEqual({
      to: '/diff',
      search: { review: 'rev-1', line: 42, side: 'base' },
    })
  })

  it('round-trips the Plugin Center surface', () => {
    expect(surfaceRouteFromLocation({ pathname: '/plugins' })).toEqual({
      to: '/plugins',
      search: undefined,
      params: undefined,
    })
    expect(surfaceKindForRoute({ to: '/plugins' })).toBe('plugin-center')
  })

  it('strips unknown search keys and drops empty search to undefined', () => {
    expect(parseSurfaceRoute({
      to: '/chat/new',
      search: { workspaceId: 'ws-1', bogus: 'x' },
    })).toEqual({ to: '/chat/new', search: { workspaceId: 'ws-1' } })
    expect(parseSurfaceRoute({
      to: '/chat/new',
      search: { workspaceId: undefined },
    })).toEqual({ to: '/chat/new', search: undefined })
  })

  it('rejects unknown routes, missing params, and malformed search', () => {
    expect(parseSurfaceRoute({ to: '/nope' })).toBeNull()
    expect(parseSurfaceRoute({ to: '/chat/$sessionId' })).toBeNull()
    expect(parseSurfaceRoute({ to: '/chat/$sessionId', params: { sessionId: '' } })).toBeNull()
    expect(surfaceRouteFromLocation({ pathname: '/chat' })).toBeNull()
    expect(surfaceRouteFromLocation({ pathname: '/plugins/browser' })).toBeNull()
  })

  it('classifies settings as overlay-only and every other kind persistable', () => {
    for (const kind of SURFACE_KINDS) {
      expect(isSurfaceKindPersistable(kind), kind).toBe(kind !== 'settings')
    }
  })
})

describe('persisted surface correlation', () => {
  const base = { title: 'Tab', order: 0, closable: true }

  it('accepts a correlated kind/id/route record', () => {
    expect(persistedSurfaceSchema.safeParse({
      id: 'chat:session-1',
      kind: 'chat',
      route: { to: '/chat/$sessionId', params: { sessionId: 'session-1' } },
      ...base,
    }).success).toBe(true)
  })

  it('rejects a kind that does not match the route', () => {
    expect(persistedSurfaceSchema.safeParse({
      id: 'chat:session-1',
      kind: 'plugin',
      route: { to: '/chat/$sessionId', params: { sessionId: 'session-1' } },
      ...base,
    }).success).toBe(false)
  })

  it('rejects an id derived from a different resource than the route', () => {
    expect(persistedSurfaceSchema.safeParse({
      id: 'chat:other-session',
      kind: 'chat',
      route: { to: '/chat/$sessionId', params: { sessionId: 'session-1' } },
      ...base,
    }).success).toBe(false)
    expect(persistedSurfaceSchema.safeParse({
      id: 'plugin-center',
      kind: 'plugin-center',
      route: { to: '/chat/$sessionId', params: { sessionId: 'session-1' } },
      ...base,
    }).success).toBe(false)
  })
})
