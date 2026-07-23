interface PluginSourceExampleChipProps {
  label: string
  value: string
  onPick: (value: string) => void
}

export function PluginSourceExampleChip({
  label,
  value,
  onPick,
}: PluginSourceExampleChipProps) {
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      className="rounded-md border border-border/60 bg-card px-2 py-1 text-left text-[10.5px] text-muted-foreground transition hover:text-foreground"
    >
      <span className="font-medium text-foreground/80">{label}</span>
      <span className="ml-1 font-mono">{value}</span>
    </button>
  )
}
