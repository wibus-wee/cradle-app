import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'

import type { SkillImportResult } from './skill-import-contract'

interface SkillImportDoneViewProps {
  result: SkillImportResult
  onClose: () => void
}

export function SkillImportDoneView({ result, onClose }: SkillImportDoneViewProps) {
  const { t } = useTranslation('skills')

  return (
    <div className="flex h-full flex-col items-center justify-center gap-7 px-6 py-12 text-center sm:px-8">
      <div className="flex flex-col gap-1.5">
        <span className="text-[17px] font-semibold text-foreground">{t('import.done')}</span>
        <span className="text-[13px] text-muted-foreground/55">
          {t('import.installed', { count: result.imported })}
        </span>
      </div>

      {result.errors.length > 0 && (
        <div className="w-full rounded-xl bg-destructive/6 px-4 py-3.5 text-left">
          <span className="mb-2 block text-[12px] font-medium text-destructive">
            {t('import.failed', { count: result.errors.length })}
          </span>
          {result.errors.map(error => (
            <div key={error.dir} className="border-t border-destructive/10 py-1.5">
              <span className="block truncate font-mono text-[10px] text-muted-foreground/40">
                {error.dir}
              </span>
              <span className="block text-[11px] text-destructive/70">{error.error}</span>
            </div>
          ))}
        </div>
      )}

      <Button
        onClick={onClose}
        variant="outline"
        className="h-10 w-full"
        data-testid="skill-import-done-btn"
      >
        {t('import.finish')}
      </Button>
    </div>
  )
}
