import { CodeView } from '@pierre/diffs/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useState } from 'react'

import { buildDiffData } from '~/components/common/diff/diff-data'
import { buildDiffOptions } from '~/components/common/diff/diff-options'
import { DiffWorkerProvider } from '~/components/common/diff/diff-runtime'
import { useAppThemeType } from '~/components/common/diff/use-app-theme'

import type { DiffStyle } from '../../shared/types'
import { reviewPatchFixture } from '../fixtures/review-fixtures'
import { cleanWorkingTreeFixture, workingTreeFixture } from '../fixtures/working-tree-fixtures'
import type { WorkingTreeModel } from '../working-tree-model'
import { WorkingTreeView } from '../working-tree-view'

function WorkingTreeScene({ model: initialModel }: { model: WorkingTreeModel }) {
  const [model, setModel] = useState(initialModel)
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(initialModel.files[0]?.id ?? null)
  const [commitSubject, setCommitSubject] = useState('')

  const diffData = useMemo(() => buildDiffData(reviewPatchFixture), [])
  const themeType = useAppThemeType()
  const options = useMemo(() => buildDiffOptions(diffStyle, { themeType }), [diffStyle, themeType])

  const setStaged = (ids: string[], staged: boolean) => {
    setModel(current => ({
      ...current,
      files: current.files.map(item => (ids.includes(item.id) ? { ...item, staged } : item)),
    }))
  }

  return (
    <DiffWorkerProvider>
      <div className="h-screen w-full">
        <WorkingTreeView
          model={model}
          selectedFileId={selectedFileId}
          onSelectFile={file => setSelectedFileId(file.id)}
          onToggleStage={file => setStaged([file.id], !file.staged)}
          onStageAll={() => setStaged(model.files.map(item => item.id), true)}
          onUnstageAll={() => setStaged(model.files.map(item => item.id), false)}
          onDiscard={() => {}}
          diffStyle={diffStyle}
          onDiffStyleChange={setDiffStyle}
          commitSubject={commitSubject}
          onCommitSubjectChange={setCommitSubject}
          onCommit={() => {}}
          onBack={() => {}}
          onRefresh={() => {}}
          onAskAgent={() => {}}
          diffSlot={(
            <CodeView
              items={diffData.items}
              options={options}
              className="h-full overflow-auto overscroll-contain [overflow-anchor:none]"
            />
          )}
        />
      </div>
    </DiffWorkerProvider>
  )
}

const meta = {
  title: 'Diffs/WorkingTreeView',
  component: WorkingTreeScene,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof WorkingTreeScene>

export default meta

type Story = StoryObj<typeof meta>

export const DirtyTree: Story = {
  args: { model: workingTreeFixture },
}

export const CleanTree: Story = {
  args: { model: cleanWorkingTreeFixture },
}
