import { cn } from '~/lib/cn'

import type { SkillImportDialogStep } from './skill-import-contract'

const DOT_STEPS: SkillImportDialogStep[] = ['input', 'fetching', 'select', 'done']

interface SkillImportStepDotsProps {
  current: SkillImportDialogStep
}

export function SkillImportStepDots({ current }: SkillImportStepDotsProps) {
  const index = DOT_STEPS.indexOf(current === 'installing' ? 'select' : current)

  return (
    <div className="flex items-center gap-1.5">
      {DOT_STEPS.map((step, stepIndex) => (
        <div
          key={step}
          className={cn(
            'h-1 rounded-full transition-colors duration-150',
            stepIndex < index
              ? 'w-2 bg-foreground/30'
              : stepIndex === index
                ? 'w-5 bg-foreground/60'
                : 'w-2 bg-foreground/10',
          )}
        />
      ))}
    </div>
  )
}
