import { CheckLine as CheckIcon } from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { TruncatedText } from '~/components/ui/truncated-text'
import { cn } from '~/lib/cn'

import type { SkillImportFetchResult } from './skill-import-contract'

interface SkillImportSelectViewProps {
  result: SkillImportFetchResult
  selected: Set<string>
  isInstalling: boolean
  onToggle: (skillDir: string) => void
  onToggleAll: () => void
  onInstall: () => void
}

export function SkillImportSelectView({
  result,
  selected,
  isInstalling,
  onToggle,
  onToggleAll,
  onInstall,
}: SkillImportSelectViewProps) {
  const { t } = useTranslation('skills')

  if (result.skills.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 py-12 text-center">
        <p className="text-[13px] text-muted-foreground/50">{t('import.empty')}</p>
      </div>
    )
  }

  const allSelected = selected.size === result.skills.length

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-6 pt-7 pb-3 sm:px-8">
        <h2 className="text-balance text-[16px] font-semibold text-foreground">
          {t('import.selectedHeading', { count: result.skills.length })}
        </h2>
        <button
          type="button"
          onClick={onToggleAll}
          className="text-[12px] text-muted-foreground/40 transition-colors hover:text-foreground"
        >
          {allSelected ? t('import.deselectAll') : t('import.selectAll')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-4 sm:px-8">
        <div className="flex flex-col gap-1.5">
          {result.skills.map((skill) => {
            const isSelected = selected.has(skill.skillDir)

            return (
              <button
                key={skill.skillDir}
                type="button"
                onClick={() => onToggle(skill.skillDir)}
                className={cn(
                  'flex items-start gap-3.5 rounded-xl px-4 py-3.5 text-left transition-[background-color,box-shadow] duration-150',
                  isSelected
                    ? 'bg-foreground/6 ring-1 ring-foreground/10 hover:bg-foreground/7'
                    : 'bg-foreground/2.5 ring-1 ring-transparent hover:bg-foreground/4',
                )}
              >
                <div
                  className={cn(
                    'mt-px flex size-4 shrink-0 items-center justify-center rounded transition-[background-color,box-shadow] duration-150',
                    isSelected
                      ? 'bg-foreground ring-1 ring-foreground'
                      : 'ring-1 ring-foreground/20 hover:ring-foreground/40',
                  )}
                >
                  {isSelected && (
                    <CheckIcon className="size-2.5 stroke-[2.5] !text-background" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-foreground">
                    {skill.name}
                  </span>
                  {skill.description && (
                    <TruncatedText
                      maxLines={2}
                      className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground/55"
                    >
                      {skill.description}
                    </TruncatedText>
                  )}
                  {skill.relativePath !== '.' && (
                    <span className="mt-1 block truncate font-mono text-[10px] text-muted-foreground/25">
                      {skill.relativePath}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-t border-foreground/6 px-6 py-5 sm:px-8">
        <Button
          onClick={onInstall}
          disabled={selected.size === 0 || isInstalling}
          className="h-10 w-full"
          data-testid="skill-import-install-btn"
        >
          {isInstalling
            ? (
                <>
                  <Spinner className="size-3.5" />
                  {t('import.installing')}
                </>
              )
            : t('import.install', { count: selected.size })}
        </Button>
      </div>
    </div>
  )
}
