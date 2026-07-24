import { WorkspaceFileIconSpriteSheet } from '~/components/common/workspace-file-icon'

import type { ChangeSection } from '../lib/changes-grouping'
import { ChangeSectionView } from './change-section-view'

export interface ChangesTypeViewProps {
  sections: ChangeSection[]
  onFileClick: (path: string) => void
}

export function ChangesTypeView({
  sections,
  onFileClick,
}: ChangesTypeViewProps) {
  return (
    <div
      className="relative min-h-0 flex-1 overflow-y-auto py-2"
      data-testid="changes-panel-sections"
    >
      <WorkspaceFileIconSpriteSheet />
      {sections
        .filter(section => section.files.length > 0)
        .map(section => (
          <ChangeSectionView
            key={section.id}
            section={section}
            onFileClick={onFileClick}
          />
        ))}
    </div>
  )
}
