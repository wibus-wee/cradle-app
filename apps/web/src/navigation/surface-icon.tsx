import {
  CalendarTimeAddLine as CalendarClockIcon,
  ChartBarLine as BarChart2Icon,
  Chat1Line as MessageCircleIcon,
  Chat1Line as MessageSquarePlusIcon,
  DashboardLine as KanbanSquareIcon,
  DotCircleLine as CircleDotIcon,
  FolderOpenLine as FolderOpenIcon,
  GitCompareLine as FileDiffIcon,
  GitPullRequestLine as WorkIcon,
  Home2Line as HomeIcon,
  Plugin2Line,
  Settings2Line as SettingsIcon,
  SparklesLine as SparklesIcon,
} from '@mingcute/react'

import { cn } from '~/lib/cn'

import type { AppSurface, SurfaceKind } from './surface-identity'

const SURFACE_ICON_CLASS = 'size-3 shrink-0'

export function SurfaceIcon({ surface, className }: { surface: Pick<AppSurface, 'kind'>, className?: string }) {
  const kind: SurfaceKind = surface.kind
  const cls = cn(SURFACE_ICON_CLASS, className)
  switch (kind) {
    case 'home':
      return <HomeIcon className={cls} />
    case 'new-work':
    case 'work':
    case 'pull-requests':
      return <WorkIcon className={cls} />
    case 'new-chat':
      return <MessageSquarePlusIcon className={cls} />
    case 'chat':
      return <MessageCircleIcon className={cls} />
    case 'diff':
      return <FileDiffIcon className={cls} />
    case 'workspace':
      return <FolderOpenIcon className={cls} />
    case 'workspace-diffs':
      return <FileDiffIcon className={cls} />
    case 'kanban':
      return <KanbanSquareIcon className={cls} />
    case 'plugin':
      return <Plugin2Line className={cls} />
    case 'plugin-center':
      return <Plugin2Line className={cls} />
    case 'awaits':
      return <CircleDotIcon className={cls} />
    case 'automation':
      return <CalendarClockIcon className={cls} />
    case 'usage':
      return <BarChart2Icon className={cls} />
    case 'settings':
      return <SettingsIcon className={cls} />
    case 'onboarding':
      return <SparklesIcon className={cls} />
    case 'devtool':
      return <SparklesIcon className={cls} />
  }
}
