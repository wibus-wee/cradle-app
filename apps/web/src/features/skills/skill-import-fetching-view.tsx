import { useTranslation } from 'react-i18next'

import { Spinner } from '~/components/ui/spinner'

interface SkillImportFetchingViewProps {
  source: string
}

export function SkillImportFetchingView({ source }: SkillImportFetchingViewProps) {
  const { t } = useTranslation('skills')

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8 py-12 text-center">
      <Spinner className="size-6 text-muted-foreground/40" />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[14px] font-medium text-foreground">{t('import.fetching')}</span>
        <span className="max-w-64 truncate text-[12px] text-muted-foreground/50">{source}</span>
      </div>
    </div>
  )
}
