export function ShortcutKeyList({ keys }: { keys: readonly string[] }) {
  return (
    <div className="flex max-w-[18rem] flex-wrap justify-end gap-1.5">
      {keys.map(key => (
        <kbd
          key={key}
          className="inline-flex h-6 items-center rounded-md border border-border bg-muted px-1.5 font-mono text-[11px] leading-none text-foreground"
        >
          {key}
        </kbd>
      ))}
    </div>
  )
}
