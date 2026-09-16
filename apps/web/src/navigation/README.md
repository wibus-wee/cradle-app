# Navigation

Navigation owns one thing: the surface route. A surface is a top-level tab, and
a tab is nothing but a `SurfaceRoute` — the serialized location of the
interface it shows. That single decision is what makes surfaces lossless across
the tab bar, persistence, split panes, drag payloads, and tear-off windows.

## The codec boundary

`surface-route-codec.ts` is the single authority for route↔surface semantics.
One discriminated Zod union (`surfaceRouteSchema`) declares every supported
route — its `to`, required params, and owned search fields — and `SurfaceRoute`
is inferred from it. Three operations run through that schema:

- **Router-state decode** — `surfaceRouteFromLocation({pathname, params, search})`
  turns a live router location into the canonical route. `active-surface.ts`
  feeds it `router.state`; nothing else may reconstruct a route from a
  location.
- **Untrusted decode** — `parseSurfaceRoute(value)` validates anything that
  crossed a serialization boundary: persisted JSON, split-pane layouts, drag
  payloads, tear-off IPC bindings. A malformed route returns `null` and is
  dropped rather than reaching the router.
- **Router-options encode** — `surfaceRouteNavigateOptions(route, {replace})`
  produces per-route `navigate`/`buildLocation` options with the `to`
  discriminator preserved, so params/search typecheck against the target
  route. Callers must not assemble `{to, params, search}` literals for surface
  navigation or cast to router option types.

Feature domains keep owning the *meaning* of their search values — the diff
anchor fields come from `diff-review/shared/search-params`, a leaf module the
codec consumes. If a search contract lives in a feature, extract a leaf module
rather than duplicating the fields here or importing the feature (which would
create a navigation↔feature cycle).

`surface-identity.ts` decorates decoded routes with surface metadata (`id`,
`kind`, `title`, `closable`); `surfaceIdForRoute` is the canonical identity —
two routes that address the same thing share one id, which is why a route is
usable as both a tab and a split pane.

## Persistence policy

`surface-store.ts` persists open surfaces under `cradle:surfaces:v2` through
`persistedSurfaceSchema`, which validates `kind`/`id`/`route` correlation — a
record cannot claim `kind: 'chat'` with a plugin route or an id derived from a
different resource than its route addresses.

- Every declared `SurfaceKind` is either persistable or explicitly
  overlay-only (`NON_PERSISTABLE_SURFACE_KINDS`); there is no third state.
- Stale versioned snapshots under the surface namespaces are deleted on
  rehydrate, never migrated — surface tabs are rebuildable UI state.
- Split-pane routes (`cradle:split-workspaces:v1`) revalidate through
  `parseSurfaceRoute` on load; undecodable panes are dropped and a workspace
  whose primary pane fails collapses out entirely.
- Equivalent routes normalize before compare: empty search records collapse to
  `undefined` so `?` noise doesn't oscillate store updates.

## The settings exception

`settings` is the one overlay-only kind. `/settings/$section` decodes and
navigates like any surface, but it is a modal layer over the current surface,
not a tab — `isSurfaceKindPersistable('settings')` is `false` and the store
drops it during normalization. This is policy, tested in both
`surface-route-codec.test.ts` and `surface-store.test.ts`, not an accident of
validation.

## Adding a route or surface

1. Declare the route variant in `surfaceRouteSchema` — `to` literal, required
   `params` object, and `search` shape (use `optionalSearch` for optional
   search, `noRouteSearch`/`noRouteParams` when absent). Reuse the feature's
   leaf search module when one owns the fields.
2. Add the `to → kind` entry in `SURFACE_KIND_BY_ROUTE_TO`; a new `SurfaceKind`
   also needs a `SURFACE_KINDS` entry — the codec asserts the maps stay in
   parity at compile time.
3. Add the identity case in `surfaceIdForRoute` (and a `*SurfaceId` helper if
   the id is resource-derived) plus a title in `SURFACE_TITLES`.
4. If the kind is overlay-only, add it to `NON_PERSISTABLE_SURFACE_KINDS` with a
   comment — otherwise it persists automatically.
5. Add a row to the `ROUTE_MATRIX` in `surface-route-codec.test.ts`; the
   coverage test fails until every route has one.
6. Wire the open/activate commands in `navigation-commands.ts` — they build a
   `SurfaceDraft` and call `router.navigate(surfaceRouteNavigateOptions(...))`.
   Never reintroduce a router-options cast: if a new route can't encode
   cleanly, fix the codec, not the call site.
