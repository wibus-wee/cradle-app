import { CheckLine as CheckIcon } from '@mingcute/react'
import { m } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { HalftoneArt } from '~/components/ui/canvas-art'
import { cn } from '~/lib/cn'

import type { SkillImportDialogViewState } from './skill-import-contract'
import type { SkillScope } from './types'

interface SkillImportAsideViewProps {
  state: SkillImportDialogViewState
  scope: SkillScope
}

export function SkillImportAsideView({ state, scope }: SkillImportAsideViewProps) {
  const { t } = useTranslation('skills')
  const { step, fetchResult, selected, importResult } = state

  return (
    <aside
      className="relative hidden w-[42%] flex-col overflow-hidden bg-foreground/2 sm:flex"
      style={{ boxShadow: 'inset 1px 0 0 oklch(from var(--foreground) l c h / 0.05)' }}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-0 transition-opacity duration-700',
          step === 'input' ? 'opacity-50' : step === 'fetching' ? 'opacity-25' : 'opacity-0',
        )}
      >
        <HalftoneArt />
      </div>

      <div className="relative z-10 h-full">
        {step === 'input' && (
          <div className="flex h-full flex-col justify-end px-7 pb-8">
            <p className="text-[13px] leading-relaxed text-muted-foreground text-pretty">
              {t('import.description')}
            </p>
          </div>
        )}

        {step === 'fetching' && (
          <div className="flex h-full flex-col justify-end gap-3 px-7 pb-8">
            <div className="relative h-px overflow-hidden rounded-full bg-foreground/10">
              <m.div
                className="absolute inset-y-0 w-1/3 rounded-full bg-foreground/40"
                animate={{ x: ['-100%', '300%'] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
            <p className="truncate text-[11px] text-muted-foreground/40">
              {state.sourceInput}
            </p>
          </div>
        )}

        {(step === 'select' || step === 'installing') && fetchResult && (
          <div className="flex h-full flex-col gap-5 px-7 py-8">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-[44px] leading-none font-bold tracking-tight text-foreground">
                  {fetchResult.skills.length}
                </span>
                <span className="text-[13px] text-muted-foreground/50">
                  {t('import.skillsFound', { count: fetchResult.skills.length })}
                </span>
              </div>
              <p className="mt-1.5 text-[12px] text-muted-foreground/40">
                {t('import.selectedSummary', { count: selected.size, scope })}
              </p>
            </div>

            <div className="h-px bg-foreground/6" />

            <div className="flex flex-col gap-0.5 overflow-hidden">
              {fetchResult.skills.slice(0, 9).map((skill) => {
                const isSelected = selected.has(skill.skillDir)
                return (
                  <div
                    key={skill.skillDir}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-opacity',
                      isSelected ? 'opacity-100' : 'opacity-20',
                    )}
                  >
                    <CheckIcon
                      className={cn(
                        'size-3 shrink-0',
                        isSelected
                          ? '!text-emerald-500'
                          : '!text-muted-foreground/20',
                      )}
                    />
                    <span className="truncate text-[12px] text-foreground">{skill.name}</span>
                  </div>
                )
              })}
              {fetchResult.skills.length > 9 && (
                <p className="px-2 text-[11px] text-muted-foreground/30">
                  {t('import.more', { count: fetchResult.skills.length - 9 })}
                </p>
              )}
            </div>
          </div>
        )}

        {step === 'done' && importResult && (
          <div className="flex h-full flex-col justify-center gap-2 px-8 py-10">
            <m.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="text-[56px] leading-none font-bold tracking-tight text-foreground"
            >
              {importResult.imported}
            </m.p>
            <p className="text-[14px] text-muted-foreground/50">
              {t('import.installed', { count: importResult.imported })}
            </p>
          </div>
        )}
      </div>
    </aside>
  )
}
