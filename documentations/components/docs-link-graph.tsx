import {
  ArrowRightLine as ArrowRight,
  Link2Line as Link2,
  RouteLine as Route,
  ScanLine as ScanSearch,
  SitemapLine as ChartNetwork,
  WarningLine as AlertTriangle,
} from '@mingcute/react'

import { cn } from '@/lib/cn'
import type { DocsGraphPageScore } from '@/lib/docs-graph'
import { buildDocsGraph } from '@/lib/docs-graph'

import { GraphView } from './graph-view'

const sectionLabels = {
  'agents': 'Agent',
  'automation': 'Automation',
  'chat': 'Chat',
  'chronicle': 'Chronicle',
  'developers': '开发者',
  'getting-started': '入门',
  'home': '首页',
  'integrations': '集成',
  'kanban': 'Kanban',
  'map': '地图',
  'operations': '运维',
  'troubleshooting': 'Troubleshooting',
  'workspace': 'Workspace',
} satisfies Record<string, string>

const statItems = [
  {
    key: 'pageCount',
    label: '页面',
    icon: Route,
  },
  {
    key: 'internalLinkCount',
    label: '站内关系',
    icon: ChartNetwork,
  },
  {
    key: 'rawReferenceCount',
    label: '抽取引用',
    icon: Link2,
  },
  {
    key: 'unresolvedReferenceCount',
    label: '未解析',
    icon: AlertTriangle,
  },
] satisfies Array<{
  key: 'pageCount' | 'internalLinkCount' | 'rawReferenceCount' | 'unresolvedReferenceCount'
  label: string
  icon: typeof Route
}>

function sectionLabel(section: string) {
  return sectionLabels[section as keyof typeof sectionLabels] ?? section
}

function MetricCard({
  label,
  value,
  icon: Icon,
  muted = false,
}: {
  label: string
  value: number
  icon: typeof Route
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-3 shadow-sm',
        muted
          ? 'border-amber-500/25 bg-amber-500/10 text-amber-950 dark:text-amber-100'
          : 'border-fd-border bg-fd-card text-fd-foreground',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-fd-muted-foreground">{label}</span>
        <Icon className="size-4 text-fd-muted-foreground" aria-hidden="true" />
      </div>
      <p className="m-0 mt-2 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function PageScoreList({
  pages,
  title,
  empty,
}: {
  pages: DocsGraphPageScore[]
  title: string
  empty: string
}) {
  return (
    <section className="rounded-lg border border-fd-border bg-fd-card p-4 shadow-sm">
      <h3 className="m-0 text-sm font-medium leading-6 text-fd-foreground">{title}</h3>
      <div className="mt-3 flex flex-col gap-2">
        {pages.length > 0
? (
          pages.map(page => (
            <a
              key={page.url}
              href={page.url}
              className="group grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 text-sm no-underline transition-colors duration-150 hover:bg-fd-muted"
            >
              <span className="min-w-0">
                <span className="block truncate text-fd-foreground">{page.title}</span>
                <span className="block text-xs leading-5 text-fd-muted-foreground">
                  {sectionLabel(page.section)}
                </span>
              </span>
              <span className="tabular-nums text-xs leading-5 text-fd-muted-foreground">
                {page.inboundCount}
{' '}
/
{page.outboundCount}
              </span>
            </a>
          ))
        )
: (
          <p className="m-0 text-sm leading-6 text-fd-muted-foreground">{empty}</p>
        )}
      </div>
    </section>
  )
}

export function DocsLinkGraph() {
  const graph = buildDocsGraph()

  return (
    <div className="not-prose my-8 space-y-4">
      <section className="overflow-hidden rounded-lg border border-fd-border bg-fd-card shadow-sm">
        <div className="border-b border-fd-border p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-violet-500/15 text-violet-700 dark:text-violet-200">
                <ChartNetwork className="size-4" aria-hidden="true" />
              </span>
              <div>
                <h3 className="m-0 text-base font-semibold leading-7 text-fd-foreground">
                  Fumadocs 链接图谱
                </h3>
                <p className="m-0 mt-1 max-w-2xl text-sm leading-6 text-fd-muted-foreground">
                  这部分直接读取 `source.getPages()` 和每个页面的 `extractedReferences`，把
                  Markdown 链接解析成站内边，帮助发现文档之间是否真的互相解释。
                </p>
              </div>
            </div>
            <div className="inline-flex min-h-10 items-center gap-2 rounded-md border border-fd-border bg-fd-background px-3 text-sm text-fd-muted-foreground">
              <ScanSearch className="size-4" aria-hidden="true" />
              构建时生成
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-b border-fd-border p-4 sm:grid-cols-2 xl:grid-cols-4">
          {statItems.map(item => (
            <MetricCard
              key={item.key}
              label={item.label}
              value={graph.stats[item.key]}
              icon={item.icon}
              muted={item.key === 'unresolvedReferenceCount' && graph.stats[item.key] > 0}
            />
          ))}
        </div>

        <div className="p-4">
          <GraphView graph={graph} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <PageScoreList
          title="被引用最多的页面"
          pages={graph.topLinkedPages}
          empty="还没有足够的站内引用形成中心页面。"
        />
        <PageScoreList
          title="需要补上下文的页面"
          pages={graph.weakPages}
          empty="所有页面都有基本的入站与出站关系。"
        />
      </div>

      {graph.unresolvedReferences.length > 0
? (
        <section className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-4 text-amber-950 shadow-sm dark:text-amber-100">
          <h3 className="m-0 text-sm font-medium leading-6">未解析的本地引用</h3>
          <div className="mt-3 flex flex-col gap-2">
            {graph.unresolvedReferences.map(reference => (
              <div
                key={`${reference.sourceUrl}:${reference.href}`}
                className="grid gap-2 rounded-md bg-fd-background/70 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center"
              >
                <a href={reference.sourceUrl} className="truncate text-fd-foreground no-underline">
                  {reference.sourceTitle}
                </a>
                <ArrowRight className="hidden size-4 !text-fd-muted-foreground sm:block" />
                <code className="truncate text-xs text-fd-muted-foreground">{reference.href}</code>
              </div>
            ))}
          </div>
        </section>
      )
: null}
    </div>
  )
}
