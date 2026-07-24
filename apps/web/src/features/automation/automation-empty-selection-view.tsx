import {
  CalendarTimeAddLine as CalendarClockIcon,
  PlusLine as PlusIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty'

export interface AutomationEmptySelectionViewProps {
  onCreate: () => void
}

export function AutomationEmptySelectionView({
  onCreate,
}: AutomationEmptySelectionViewProps) {
  const { t } = useTranslation('automation')

  return (
    <div className="flex h-full items-center justify-center">
      <Empty className="border-none">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarClockIcon />
          </EmptyMedia>
          <EmptyTitle>{t('emptySelection.title')}</EmptyTitle>
          <EmptyDescription>
            {t('emptySelection.description')}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onCreate}>
            <PlusIcon className="size-3.5" />
            {t('action.createAutomation')}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
