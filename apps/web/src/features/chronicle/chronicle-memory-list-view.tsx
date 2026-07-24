import { ChronicleMemoryCardView } from './chronicle-memory-card-view'
import type { MemoryEntry } from './use-chronicle'

export interface ChronicleMemoryListViewProps {
  entries: MemoryEntry[]
  focusedMemoryId: string | null
}

export function ChronicleMemoryListView({
  entries,
  focusedMemoryId,
}: ChronicleMemoryListViewProps) {
  return (
    <div className="flex flex-col gap-2">
      {entries.map(entry => (
        <ChronicleMemoryCardView
          key={entry.id}
          entry={entry}
          focused={entry.id === focusedMemoryId}
        />
      ))}
    </div>
  )
}
