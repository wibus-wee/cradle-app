import { useMemo } from 'react'

import { useActiveSurface } from '~/navigation/active-surface'
import { sortSurfaces } from '~/navigation/surface-identity'
import { useSurfaceStore } from '~/navigation/surface-store'

function RouteDetails({ value }: { value: unknown }) {
  return (
    <pre className="max-w-[360px] overflow-auto rounded bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function SurfacesPanel() {
  const surfaces = useSurfaceStore(state => state.surfaces)
  const activeSurface = useActiveSurface()
  const activeSurfaceId = activeSurface?.id ?? null
  const orderedSurfaces = useMemo(() => sortSurfaces(surfaces), [surfaces])

  return (
    <div className="h-full overflow-auto p-4 font-mono text-[11px]">
      <div className="mb-4 flex items-center gap-2">
        <div className="text-xs text-muted-foreground">Router Surfaces</div>
        <div className="ml-auto rounded border border-border px-2 py-1 text-muted-foreground">
          {orderedSurfaces.length}
          {' '}
          open
        </div>
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <section>
          <div className="mb-2 text-xs text-muted-foreground">Snapshot</div>
          <table className="w-full text-left">
            <tbody>
              <tr className="border-b border-border">
                <td className="py-1.5 pr-6 text-muted-foreground">Active Surface</td>
                <td className="py-1.5 text-foreground">{activeSurfaceId ?? '-'}</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-1.5 pr-6 text-muted-foreground">Active Kind</td>
                <td className="py-1.5 text-foreground">{activeSurface?.kind ?? '-'}</td>
              </tr>
              <tr className="border-b border-border">
                <td className="py-1.5 pr-6 text-muted-foreground">Storage</td>
                <td className="py-1.5 text-foreground">cradle:surfaces:v1</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <section>
        <div className="mb-2 text-xs text-muted-foreground">Surfaces</div>
        <div className="overflow-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-1.5 pr-3 font-normal">ID</th>
                <th className="py-1.5 pr-3 font-normal">Kind</th>
                <th className="py-1.5 pr-3 font-normal">Title</th>
                <th className="py-1.5 pr-3 font-normal">Active</th>
                <th className="py-1.5 pr-3 font-normal">Closable</th>
                <th className="py-1.5 font-normal">Route</th>
              </tr>
            </thead>
            <tbody>
              {orderedSurfaces.map(surface => (
                <tr key={surface.id} className="border-b border-border align-top">
                  <td className="py-1.5 pr-3 text-muted-foreground">{surface.id}</td>
                  <td className="py-1.5 pr-3">{surface.kind}</td>
                  <td className="max-w-[240px] truncate py-1.5 pr-3">{surface.title}</td>
                  <td className={activeSurfaceId === surface.id ? 'py-1.5 pr-3 text-foreground' : 'py-1.5 pr-3 text-muted-foreground/60'}>
                    {activeSurfaceId === surface.id ? 'yes' : 'no'}
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{surface.closable ? 'yes' : 'no'}</td>
                  <td className="py-1.5">
                    <RouteDetails value={surface.route} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
