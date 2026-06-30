import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group'

import type { CodexAuthModeValue } from './codex-auth-modes'
import { CODEX_AUTH_MODE_OPTIONS, normalizeCodexAuthMode } from './codex-auth-modes'

export function CodexAuthModeToggle({
  value,
  disabled,
  onChange,
}: {
  value: string | null | undefined
  disabled?: boolean
  onChange: (value: CodexAuthModeValue) => void
}) {
  const currentValue = normalizeCodexAuthMode(value)

  return (
    <ToggleGroup
      type="single"
      orientation="vertical"
      value={currentValue}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onChange(normalizeCodexAuthMode(nextValue))
        }
      }}
      disabled={disabled}
      className="w-56 items-stretch rounded-lg bg-muted/35 p-1 ring-1 ring-foreground/6"
    >
      {CODEX_AUTH_MODE_OPTIONS.map(option => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          size="sm"
          className="h-8 w-full justify-start text-[11.5px] data-[state=on]:bg-background data-[state=on]:text-foreground"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
