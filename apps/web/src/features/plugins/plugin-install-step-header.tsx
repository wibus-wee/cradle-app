import { CheckLine as CheckIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

export type InstallStepId = 'source' | 'review' | 'install' | 'done'

const STEP_IDS: InstallStepId[] = ['source', 'review', 'install', 'done']

interface PluginInstallStepHeaderProps {
  current: InstallStepId
}

/**
 * Lightweight wizard step indicator rendered at the top of each install step
 * view. Purely presentational — steps the user already passed get a check,
 * the current step is highlighted.
 */
export function PluginInstallStepHeader({ current }: PluginInstallStepHeaderProps) {
  const { t } = useTranslation('settings')
  const currentIndex = STEP_IDS.indexOf(current)

  return (
    <ol className="flex items-center gap-1" aria-label={t('plugins.add.title')}>
      {STEP_IDS.map((id, index) => {
        const completed = index < currentIndex
        const active = index === currentIndex
        return (
          <li key={id} className="flex items-center gap-1">
            {index > 0 && (
              <span
                aria-hidden="true"
                className={cn(
                  'mx-1 h-px w-4 transition-colors duration-300',
                  index <= currentIndex ? 'bg-foreground/40' : 'bg-border',
                )}
              />
            )}
            <span
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 text-[12px] transition-colors duration-300',
                active && 'font-medium text-foreground',
                completed && 'text-muted-foreground',
                !active && !completed && 'text-muted-foreground/60',
              )}
            >
              <span
                className={cn(
                  'flex size-4.5 items-center justify-center rounded-full border text-[10px] transition-colors duration-300',
                  active && 'border-primary bg-primary text-primary-foreground',
                  completed && 'border-foreground/30 bg-transparent text-foreground/70',
                  !active && !completed && 'border-border text-muted-foreground/60',
                )}
              >
                {completed
                  ? <CheckIcon className="size-3" aria-hidden="true" />
                  : index + 1}
              </span>
              {t(`plugins.add.step.${id}`)}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
