import type { NavigateOptions } from '@tanstack/react-router'
import { z } from 'zod'

import type {
  DiffsViewSearch,
} from '~/features/diff-review/shared/search-params'
import { DIFF_ANCHOR_SIDES, parseAnchorSide, parsePositiveInt } from '~/features/diff-review/shared/search-params'
import type { router } from '~/router'

/**
 * The authoritative surface-route codec.
 *
 * One discriminated Zod union owns every supported route and search shape:
 * `SurfaceRoute` is inferred from it, and the three codec operations —
 * router-state decode ({@link surfaceRouteFromLocation}), persisted/untrusted
 * decode ({@link parseSurfaceRoute}), and router-options encode
 * ({@link surfaceRouteNavigateOptions}) — all run through the same schema.
 * Adapters (router, Zustand persistence, tear-off windows, split panes, drag
 * payloads) consume these operations instead of rebuilding route shapes.
 *
 * Policy: every declared {@link SurfaceKind} is either persistable or
 * explicitly overlay-only ({@link NON_PERSISTABLE_SURFACE_KINDS}). Optional
 * search fields normalize empties to `undefined` so equivalent routes compare
 * equal instead of oscillating store updates. Feature domains keep owning the
 * meaning of their search values — the diff anchor literals/parsers come from
 * `diff-review/shared/search-params`, not a second copy.
 */

/** Optional search entry: a non-empty string, else normalized to `undefined`. */
const searchParam = z.string().min(1).optional().catch(undefined)

/** Required path param: a missing or empty value invalidates the whole route. */
const requiredParam = z.string().min(1)

/** Diff deep-link anchor fields, validated with the route owner's primitives. */
const diffAnchorSearchShape = {
  line: z.preprocess(parsePositiveInt, z.number().int().positive().optional()),
  side: z.preprocess(parseAnchorSide, z.enum(DIFF_ANCHOR_SIDES).optional()),
}

const diffSearchShape = {
  workspace: searchParam,
  repo: searchParam,
  path: searchParam,
  review: searchParam,
  ...diffAnchorSearchShape,
  github: searchParam,
}

const workspaceDiffsSearchShape = {
  repo: searchParam,
  path: searchParam,
  review: searchParam,
  ...diffAnchorSearchShape,
  github: searchParam,
}

/**
 * Drop `undefined`-valued keys and collapse an all-empty record to `undefined`,
 * so `{issueId: undefined}` and `{}` normalize to one canonical form.
 */
function compactSearch<S extends object | undefined>(search: S): S {
  if (search == null) {
    return search
  }
  const entries = Object.entries(search).filter(([, value]) => value !== undefined)
  // `entries` can only hold a subset of `S`'s declared fields.
  return (entries.length > 0 ? Object.fromEntries(entries) : undefined) as S
}

/**
 * Optional search record on a route variant: unknown keys are stripped.
 * `Shape` must stay generic — a plain `z.ZodRawShape` parameter erases the
 * per-key types and collapses the inferred route search to an index record.
 * The trailing `.optional()` is what makes the `search` key optional on the
 * inferred route member (matching `params`/`search` on no-param routes).
 */
const optionalSearch = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.object(shape).optional().transform(compactSearch).optional()

/**
 * Routes without params/search still declare the fields so `SurfaceRoute`
 * stays total (`route.params`/`route.search` are readable on every member).
 * Junk values normalize to `undefined` rather than invalidating the route.
 */
const noRouteParams = z.unknown().transform(() => undefined).optional()
const noRouteSearch = z.unknown().transform(() => undefined).optional()

export const surfaceRouteSchema = z.discriminatedUnion('to', [
  z.object({ to: z.literal('/'), params: noRouteParams, search: noRouteSearch }),
  z.object({
    to: z.literal('/work/new'),
    params: noRouteParams,
    search: optionalSearch({ workspaceId: searchParam, issueId: searchParam }),
  }),
  z.object({
    to: z.literal('/work/$workId'),
    params: z.object({ workId: requiredParam }),
    search: noRouteSearch,
  }),
  z.object({
    to: z.literal('/pull-requests'),
    params: noRouteParams,
    search: optionalSearch({ pr: searchParam }),
  }),
  z.object({
    to: z.literal('/chat/new'),
    params: noRouteParams,
    search: optionalSearch({
      issueId: searchParam,
      workspaceId: searchParam,
      sessionGroupId: searchParam,
    }),
  }),
  z.object({
    to: z.literal('/chat/$sessionId'),
    params: z.object({ sessionId: requiredParam }),
    search: noRouteSearch,
  }),
  z.object({
    to: z.literal('/diff'),
    params: noRouteParams,
    search: optionalSearch(diffSearchShape),
  }),
  z.object({
    to: z.literal('/workspaces/$workspaceId'),
    params: z.object({ workspaceId: requiredParam }),
    search: noRouteSearch,
  }),
  z.object({
    to: z.literal('/workspaces/$workspaceId/diffs'),
    params: z.object({ workspaceId: requiredParam }),
    search: optionalSearch(workspaceDiffsSearchShape),
  }),
  z.object({
    to: z.literal('/kanban/$boardId'),
    params: z.object({ boardId: requiredParam }),
    search: optionalSearch({ issue: searchParam, milestoneId: searchParam }),
  }),
  z.object({
    to: z.literal('/plugins/$routeSegment/$localId'),
    params: z.object({ routeSegment: requiredParam, localId: requiredParam }),
    search: noRouteSearch,
  }),
  z.object({ to: z.literal('/plugins'), params: noRouteParams, search: noRouteSearch }),
  z.object({ to: z.literal('/awaits'), params: noRouteParams, search: noRouteSearch }),
  z.object({ to: z.literal('/automation'), params: noRouteParams, search: noRouteSearch }),
  z.object({ to: z.literal('/usage'), params: noRouteParams, search: noRouteSearch }),
  z.object({
    to: z.literal('/settings/$section'),
    params: z.object({ section: requiredParam }),
    search: noRouteSearch,
  }),
  z.object({ to: z.literal('/onboarding'), params: noRouteParams, search: noRouteSearch }),
  z.object({ to: z.literal('/devtool'), params: noRouteParams, search: noRouteSearch }),
])

export type SurfaceRoute = z.infer<typeof surfaceRouteSchema>

export type SurfaceRouteTo = SurfaceRoute['to']

/** Compile-time parity with the diff domain's declared search contract. */
type DiffRouteSearch = Extract<SurfaceRoute, { to: '/diff' }>['search']
type _DiffSearchParity
  = NonNullable<DiffRouteSearch> extends DiffsViewSearch
    ? DiffsViewSearch extends NonNullable<DiffRouteSearch>
      ? true
      : never
    : never
const _assertDiffSearchParity: _DiffSearchParity = true

export const SURFACE_KINDS = [
  'home',
  'new-work',
  'work',
  'pull-requests',
  'new-chat',
  'chat',
  'diff',
  'workspace',
  'workspace-diffs',
  'kanban',
  'plugin',
  'plugin-center',
  'awaits',
  'automation',
  'usage',
  'settings',
  'onboarding',
  'devtool',
] as const

export type SurfaceKind = (typeof SURFACE_KINDS)[number]

export const SURFACE_KIND_BY_ROUTE_TO = {
  '/': 'home',
  '/work/new': 'new-work',
  '/work/$workId': 'work',
  '/pull-requests': 'pull-requests',
  '/chat/new': 'new-chat',
  '/chat/$sessionId': 'chat',
  '/diff': 'diff',
  '/workspaces/$workspaceId': 'workspace',
  '/workspaces/$workspaceId/diffs': 'workspace-diffs',
  '/kanban/$boardId': 'kanban',
  '/plugins/$routeSegment/$localId': 'plugin',
  '/plugins': 'plugin-center',
  '/awaits': 'awaits',
  '/automation': 'automation',
  '/usage': 'usage',
  '/settings/$section': 'settings',
  '/onboarding': 'onboarding',
  '/devtool': 'devtool',
} as const satisfies Record<SurfaceRouteTo, SurfaceKind>

// Compile-time: every declared SurfaceKind is owned by exactly one route.
type RoutedKind = (typeof SURFACE_KIND_BY_ROUTE_TO)[SurfaceRouteTo]
const _assertEveryKindIsRouted: Exclude<SurfaceKind, RoutedKind> extends never ? true : never = true

export function surfaceKindForRoute(route: SurfaceRoute): SurfaceKind {
  return SURFACE_KIND_BY_ROUTE_TO[route.to]
}

/**
 * Overlay-only kinds: they decode and navigate like any surface, but are never
 * persisted. Settings is a modal layer over the current surface, not a tab.
 */
const NON_PERSISTABLE_SURFACE_KINDS: ReadonlySet<SurfaceKind> = new Set(['settings'])

export function isSurfaceKindPersistable(kind: SurfaceKind): boolean {
  return !NON_PERSISTABLE_SURFACE_KINDS.has(kind)
}

export const HOME_SURFACE_ID = 'home'

export function chatSurfaceId(sessionId: string): string {
  return `chat:${sessionId}`
}

export function workSurfaceId(workId: string): string {
  return `work:${workId}`
}

export function pullRequestsSurfaceId(): string {
  return 'pull-requests'
}

export function workspaceSurfaceId(workspaceId: string): string {
  return `workspace:${workspaceId}`
}

export function workspaceDiffsSurfaceId(workspaceId: string): string {
  return `workspace-diffs:${workspaceId}`
}

export function diffSurfaceId(): string {
  return 'diff'
}

export function kanbanSurfaceId(boardId: string): string {
  return `kanban:${boardId}`
}

export function pluginSurfaceId(routeSegment: string, localId: string): string {
  return `plugin:${routeSegment}:${localId}`
}

/**
 * Canonical identity of a route instance. Two routes that address the same
 * thing (same chat, same workspace, same settings page) share one id, which is
 * what makes a route usable both as a surface (tab) and as a split pane — the
 * same interface can never be opened twice inside one workspace.
 */
export function surfaceIdForRoute(route: SurfaceRoute): string {
  switch (route.to) {
    case '/':
      return HOME_SURFACE_ID
    case '/work/new':
      return 'new-work'
    case '/work/$workId':
      return workSurfaceId(route.params.workId)
    case '/pull-requests':
      return pullRequestsSurfaceId()
    case '/chat/new':
      return 'new-chat'
    case '/chat/$sessionId':
      return chatSurfaceId(route.params.sessionId)
    case '/diff':
      return diffSurfaceId()
    case '/workspaces/$workspaceId':
      return workspaceSurfaceId(route.params.workspaceId)
    case '/workspaces/$workspaceId/diffs':
      return workspaceDiffsSurfaceId(route.params.workspaceId)
    case '/kanban/$boardId':
      return kanbanSurfaceId(route.params.boardId)
    case '/plugins/$routeSegment/$localId':
      return pluginSurfaceId(route.params.routeSegment, route.params.localId)
    case '/plugins':
      return 'plugin-center'
    case '/awaits':
      return 'awaits'
    case '/automation':
      return 'automation'
    case '/usage':
      return 'usage'
    case '/settings/$section':
      return 'settings'
    case '/onboarding':
      return 'onboarding'
    case '/devtool':
      return 'devtool'
  }
}

/**
 * Persisted-surface decode with kind/id/route correlation: a record cannot
 * claim `kind: 'chat'` with a Plugin route, or an id derived from a different
 * resource than its route addresses. Overlays (settings) decode here and are
 * filtered out by the store's normalization policy, not hidden in the schema.
 */
export const persistedSurfaceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(SURFACE_KINDS),
  title: z.string(),
  route: surfaceRouteSchema,
  order: z.number().finite(),
  closable: z.boolean(),
}).superRefine((surface, context) => {
  if (surface.kind !== surfaceKindForRoute(surface.route)) {
    context.addIssue({ code: 'custom', message: `kind '${surface.kind}' does not match route '${surface.route.to}'` })
  }
  if (surface.id !== surfaceIdForRoute(surface.route)) {
    context.addIssue({ code: 'custom', message: `id '${surface.id}' does not match route '${surface.route.to}'` })
  }
})

/**
 * Untrusted decode: persisted JSON, drag payloads, and tear-off IPC bindings
 * all cross a serialization boundary where a malformed route would otherwise
 * reach the router as a navigation target.
 */
export function parseSurfaceRoute(value: unknown): SurfaceRoute | null {
  const parsed = surfaceRouteSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

interface SurfaceRouteTemplate {
  to: SurfaceRouteTo
  segments: string[]
  paramNames: string[]
}

/**
 * Pathname → route `to` matching, derived from the codec table itself so a new
 * route needs exactly one entry. More static segments win (`/chat/new` beats
 * `/chat/$sessionId`), mirroring the router's own ranking.
 */
const SURFACE_ROUTE_TEMPLATES: SurfaceRouteTemplate[] = (Object.keys(SURFACE_KIND_BY_ROUTE_TO) as SurfaceRouteTo[])
  .map((to) => {
    const segments = to.split('/').filter(Boolean)
    return {
      to,
      segments,
      paramNames: segments.filter(segment => segment.startsWith('$')).map(segment => segment.slice(1)),
    }
  })
  .sort((a, b) => a.paramNames.length - b.paramNames.length)

function normalizeLocationPathname(pathname: string): string {
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return trimmed === '/home' ? '/' : trimmed
}

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  }
  catch {
    return segment
  }
}

function matchTemplate(
  template: SurfaceRouteTemplate,
  pathname: string,
): Record<string, string> | null {
  const pathnameSegments = pathname.split('/').filter(Boolean)
  if (pathnameSegments.length !== template.segments.length) {
    return null
  }

  const captures: Record<string, string> = {}
  for (let index = 0; index < template.segments.length; index += 1) {
    const segment = template.segments[index]!
    const actual = pathnameSegments[index]!
    if (segment.startsWith('$')) {
      captures[segment.slice(1)] = decodePathSegment(actual)
    }
    else if (segment !== actual) {
      return null
    }
  }
  return captures
}

/**
 * Router-state decode: a live location (pathname + matched params + validated
 * search) becomes the canonical surface route. Router-provided params win
 * over raw pathname captures because they are already decoded.
 */
export function surfaceRouteFromLocation(input: {
  pathname: string
  params?: Record<string, unknown>
  search?: Record<string, unknown>
}): SurfaceRoute | null {
  const pathname = normalizeLocationPathname(input.pathname)
  for (const template of SURFACE_ROUTE_TEMPLATES) {
    const captures = matchTemplate(template, pathname)
    if (!captures) {
      continue
    }
    const params: Record<string, unknown> = {}
    for (const name of template.paramNames) {
      params[name] = input.params?.[name] ?? captures[name]
    }
    return parseSurfaceRoute({
      to: template.to,
      params: template.paramNames.length > 0 ? params : undefined,
      search: input.search,
    })
  }
  return null
}

/**
 * `router.navigate`/`buildLocation` accept a generic `NavigateOptions` whose
 * `TTo` is inferred per call — so `Parameters<typeof router.navigate>[0]`
 * only sees the unresolved constraint (params as `true | ParamsReducerFn`),
 * which is what historically forced `as` casts. Keying `NavigateOptions` by
 * each surface route's `to` preserves the discriminator: every member of this
 * union carries its own params/search contract and feeds both entry points
 * without any widening.
 */
export type SurfaceRouteNavigateOptions = {
  [To in SurfaceRouteTo]: NavigateOptions<typeof router, string, To>
}[SurfaceRouteTo]

/**
 * Router-options encode, preserving the route's discrimination all the way to
 * TanStack Router's per-route option union — no record widening, no cast.
 */
export function surfaceRouteNavigateOptions(
  route: SurfaceRoute,
  options: { replace?: boolean } = {},
): SurfaceRouteNavigateOptions {
  const replace = options.replace ?? false
  switch (route.to) {
    case '/':
      return { to: route.to, replace }
    case '/work/new':
      return { to: route.to, search: route.search, replace }
    case '/work/$workId':
      return { to: route.to, params: route.params, replace }
    case '/pull-requests':
      return { to: route.to, search: route.search, replace }
    case '/chat/new':
      return { to: route.to, search: route.search, replace }
    case '/chat/$sessionId':
      return { to: route.to, params: route.params, replace }
    case '/diff':
      return { to: route.to, search: route.search, replace }
    case '/workspaces/$workspaceId':
      return { to: route.to, params: route.params, replace }
    case '/workspaces/$workspaceId/diffs':
      return { to: route.to, params: route.params, search: route.search, replace }
    case '/kanban/$boardId':
      return { to: route.to, params: route.params, search: route.search, replace }
    case '/plugins/$routeSegment/$localId':
      return { to: route.to, params: route.params, replace }
    case '/plugins':
    case '/awaits':
    case '/automation':
    case '/usage':
    case '/onboarding':
    case '/devtool':
      return { to: route.to, replace }
    case '/settings/$section':
      return { to: route.to, params: route.params, replace }
    default: {
      const exhaustive: never = route
      throw new Error(`Unsupported surface route: ${JSON.stringify(exhaustive)}`)
    }
  }
}
