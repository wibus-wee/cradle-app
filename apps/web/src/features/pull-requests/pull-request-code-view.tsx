import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DiffLayoutToggle } from '~/components/common/diff/diff-layout-toggle'
import type { DiffStyle } from '~/components/common/diff/diff-options'
import { DiffWorkerProvider } from '~/components/common/diff/diff-runtime'

import type { PullRequestDetail } from './api/pull-requests'
import { PullRequestFileSectionView } from './pull-request-file-section-view'

export interface PullRequestCodeViewProps {
  files: PullRequestDetail['files']
}

export function PullRequestCodeView({
  files,
}: PullRequestCodeViewProps) {
  const { t } = useTranslation('pull-requests')
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('unified')

  if (files.length === 0) {
    return <p className="pt-6 text-[13px] text-muted-foreground/70">{t('code.noFiles')}</p>
  }

  return (
    <DiffWorkerProvider>
      <div className="space-y-2 pt-6">
        <div className="flex justify-end pb-1">
          <DiffLayoutToggle value={diffStyle} onValueChange={setDiffStyle} />
        </div>
        {files.map(file => (
          <PullRequestFileSectionView
            key={file.filename}
            file={file}
            diffStyle={diffStyle}
            patchUnavailableLabel={t('code.patchUnavailable')}
          />
        ))}
      </div>
    </DiffWorkerProvider>
  )
}
