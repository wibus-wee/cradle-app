import type { ReactNode } from 'react'

import { Label } from '~/components/ui/label'

export interface AutomationFormFieldProps {
  label: string
  description?: string
  htmlFor?: string
  children: ReactNode
}

export function AutomationFormField({
  label,
  description,
  htmlFor,
  children,
}: AutomationFormFieldProps) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-[12px] text-foreground">
        {label}
      </Label>
      {children}
      {description
        ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )
        : null}
    </div>
  )
}
