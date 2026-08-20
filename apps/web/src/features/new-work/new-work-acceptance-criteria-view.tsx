import { useTranslation } from 'react-i18next'

import { Textarea } from '~/components/ui/textarea'

interface NewWorkAcceptanceCriteriaViewProps {
  value: string
  onChange: (value: string) => void
}

export function NewWorkAcceptanceCriteriaView({
  value,
  onChange,
}: NewWorkAcceptanceCriteriaViewProps) {
  const { t } = useTranslation('work')
  return (
    <label className="mb-3 block space-y-1.5 px-1">
      <span className="text-xs font-medium text-foreground/80">{t('new.acceptanceCriteria')}</span>
      <Textarea
        value={value}
        onChange={event => onChange(event.target.value)}
        rows={2}
        className="min-h-16 resize-y bg-card text-sm"
        placeholder={t('new.acceptanceCriteriaPlaceholder')}
        aria-label={t('new.acceptanceCriteria')}
        data-testid="new-work-acceptance-criteria"
      />
      <span className="block text-[11px] leading-4 text-muted-foreground">
        {t('new.acceptanceCriteriaHint')}
      </span>
    </label>
  )
}
