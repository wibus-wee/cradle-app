import type {
  ServerPluginRouteContext,
  ServerPluginRouteMethod,
  ServerPluginRouteRegistration,
} from '@cradle/plugin-sdk/server'

export interface PluginRouteDispatchInput {
  routeSegment: string
  method: string
  path: string
  body: unknown
  query: Record<string, unknown>
  headers: Record<string, string | undefined>
  set: ServerPluginRouteContext['set']
}

export interface PluginRouteDispatchResult {
  found: boolean
  body?: unknown
}

interface RegisteredPluginRoute {
  id: string
  owner: string
  routeSegment: string
  method: ServerPluginRouteMethod
  path: string
  segments: string[]
  staticSegmentCount: number
  order: number
  handler: ServerPluginRouteRegistration['handler']
}

interface RouteMatch {
  route: RegisteredPluginRoute
  params: Record<string, string>
}

const routes = new Map<string, RegisteredPluginRoute>()
let routeOrder = 0

export function normalizePluginRoutePath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) {
    throw new Error('Plugin route path must not be empty.')
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) {
    throw new Error('Plugin route path must be relative to the plugin route scope.')
  }
  if (trimmed.includes('\\')) {
    throw new Error('Plugin route path must use forward slashes.')
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const pathname = normalized.split(/[?#]/, 1)[0] ?? '/'
  const segments = pathname.split('/').filter(Boolean)
  for (const segment of segments) {
    try {
      if (decodeURIComponent(segment) === '..') {
        throw new Error('Plugin route path must not contain traversal segments.')
      }
    }
    catch (err) {
      if (err instanceof URIError || segment === '..') {
        throw new Error('Plugin route path must not contain traversal segments.')
      }
      throw err
    }
  }

  return segments.length === 0 ? '/' : `/${segments.join('/')}`
}

function routeKey(owner: string, method: ServerPluginRouteMethod, path: string): string {
  return `${owner}\0${method}\0${path}`
}

function toRouteSegments(path: string): string[] {
  return path === '/' ? [] : path.slice(1).split('/')
}

function matchRoute(route: RegisteredPluginRoute, dispatchPath: string): RouteMatch | null {
  const dispatchSegments = toRouteSegments(dispatchPath)
  if (dispatchSegments.length !== route.segments.length) {
    return null
  }

  const params: Record<string, string> = {}
  for (let index = 0; index < route.segments.length; index += 1) {
    const patternSegment = route.segments[index]!
    const actualSegment = dispatchSegments[index]!
    if (patternSegment.startsWith(':')) {
      const paramName = patternSegment.slice(1)
      if (!paramName || actualSegment === '') {
        return null
      }
      params[paramName] = decodeURIComponent(actualSegment)
      continue
    }
    if (patternSegment !== actualSegment) {
      return null
    }
  }

  return { route, params }
}

function chooseRouteMatch(matches: RouteMatch[]): RouteMatch | null {
  if (matches.length === 0) {
    return null
  }

  const sorted = [...matches].sort((left, right) => {
    if (left.route.staticSegmentCount !== right.route.staticSegmentCount) {
      return right.route.staticSegmentCount - left.route.staticSegmentCount
    }
    return left.route.order - right.route.order
  })
  const best = sorted[0]!
  const sameSpecificity = sorted.filter(match => match.route.staticSegmentCount === best.route.staticSegmentCount)
  if (sameSpecificity.length > 1) {
    throw new Error(
      `Ambiguous plugin route match for ${best.route.method} ${best.route.routeSegment}${best.route.path}.`,
    )
  }
  return best
}

export function registerPluginRoute(
  owner: string,
  routeSegment: string,
  route: ServerPluginRouteRegistration,
): string {
  const normalizedPath = normalizePluginRoutePath(route.path)
  const key = routeKey(owner, route.method, normalizedPath)
  if (routes.has(key)) {
    throw new Error(`Duplicate plugin route registration: ${route.method} ${routeSegment}${normalizedPath}`)
  }

  const segments = toRouteSegments(normalizedPath)
  const record: RegisteredPluginRoute = {
    id: key,
    owner,
    routeSegment,
    method: route.method,
    path: normalizedPath,
    segments,
    staticSegmentCount: segments.filter(segment => !segment.startsWith(':')).length,
    order: routeOrder,
    handler: route.handler,
  }
  routeOrder += 1
  routes.set(key, record)
  return key
}

export function unregisterPluginRoute(routeId: string): void {
  routes.delete(routeId)
}

export function clearPluginRoutes(owner: string): void {
  for (const [routeId, route] of routes) {
    if (route.owner === owner) {
      routes.delete(routeId)
    }
  }
}

export function resetPluginRouteRegistry(): void {
  routes.clear()
  routeOrder = 0
}

export function listPluginRoutes(owner?: string): RegisteredPluginRoute[] {
  return [...routes.values()]
    .filter(route => owner === undefined || route.owner === owner)
    .sort((left, right) => left.order - right.order)
}

export async function dispatchPluginRoute(input: PluginRouteDispatchInput): Promise<PluginRouteDispatchResult> {
  const method = input.method.toUpperCase()
  const path = normalizePluginRoutePath(input.path)
  const matches = [...routes.values()]
    .filter(route => route.routeSegment === input.routeSegment && route.method === method)
    .map(route => matchRoute(route, path))
    .filter((match): match is RouteMatch => match !== null)

  const match = chooseRouteMatch(matches)
  if (!match) {
    return { found: false }
  }

  const body = await match.route.handler({
    body: input.body,
    params: match.params,
    query: input.query,
    headers: input.headers,
    set: input.set,
  })
  return { found: true, body }
}
