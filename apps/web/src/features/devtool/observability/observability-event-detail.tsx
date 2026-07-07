import { useObservabilityDevtoolStore } from './use-observability-events'

export function ObservabilityEventDetail() {
  const entries = useObservabilityDevtoolStore(s => s.entries)
  const selectedIndex = useObservabilityDevtoolStore(s => s.selectedIndex)
  const clear = useObservabilityDevtoolStore(s => s.clear)

  const entry = (selectedIndex === null ? null : entries[selectedIndex] ?? null)

  return (
    <div className="h-full overflow-auto p-3 font-mono text-[11px]">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => clear()}
          className="rounded border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted"
        >
          Clear
        </button>
      </div>

      {!entry && (
        <div className="text-xs text-muted-foreground/50">
          Select an event to inspect
        </div>
      )}

      {entry && (
        <div className="space-y-4">
          <div>
            <div className="mb-1 text-[10px] text-muted-foreground">Selected Payload</div>
            <pre className="whitespace-pre-wrap break-words text-foreground/80">
              {JSON.stringify(entry, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
