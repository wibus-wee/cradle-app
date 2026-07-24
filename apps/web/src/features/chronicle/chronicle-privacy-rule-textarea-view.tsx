import { Textarea } from '~/components/ui/textarea'

export interface ChroniclePrivacyRuleTextareaViewProps {
  label: string
  placeholder: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
}

export function ChroniclePrivacyRuleTextareaView({
  label,
  placeholder,
  value,
  disabled,
  onChange,
}: ChroniclePrivacyRuleTextareaViewProps) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[12px] font-medium text-muted-foreground">
        {label}
      </span>
      <Textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        className="min-h-24 resize-y font-mono text-[12px] leading-5"
      />
    </label>
  )
}
