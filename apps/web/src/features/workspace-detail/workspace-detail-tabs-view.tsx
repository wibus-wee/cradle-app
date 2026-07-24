import {
  FileLine as FileTextIcon,
  PencilLine as PencilIcon,
  ScrollableListLine as ScrollTextIcon,
} from '@mingcute/react'
import { m } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

import type { WorkspaceDetailTab } from './workspace-detail-types'

export interface WorkspaceDetailTabsViewProps {
  activeTab: WorkspaceDetailTab
  showWorkflowRules: boolean
  onChange: (tab: WorkspaceDetailTab) => void
}

export function WorkspaceDetailTabsView({
  activeTab,
  showWorkflowRules,
  onChange,
}: WorkspaceDetailTabsViewProps) {
  const { t } = useTranslation('workspace')
  const tabs = [
    {
      id: 'overview',
      label: t('detail.tab.overview'),
      icon: FileTextIcon,
    },
    ...(showWorkflowRules
      ? [{
          id: 'workflow-rules',
          label: t('detail.tab.workflow'),
          icon: ScrollTextIcon,
        } as const]
      : []),
    {
      id: 'skills',
      label: t('detail.tab.skills'),
      icon: PencilIcon,
    },
  ] satisfies Array<{
    id: WorkspaceDetailTab
    label: string
    icon: typeof FileTextIcon
  }>

  return (
    <div className="mb-6 flex items-center gap-0.5 overflow-x-auto scrollbar-none">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          data-testid={`workspace-detail-tab-${id}`}
          className={cn(
            'relative z-10 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors select-none',
            activeTab === id
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {activeTab === id
            ? (
                <m.span
                  layoutId="workspace-detail-tab-pill"
                  className="absolute inset-0 rounded-md bg-accent"
                  transition={{ type: 'spring', stiffness: 600, damping: 40 }}
                  style={{ zIndex: -1 }}
                />
              )
            : null}
          <Icon className="relative size-3.5 shrink-0" />
          <span className="relative">{label}</span>
        </button>
      ))}
    </div>
  )
}
