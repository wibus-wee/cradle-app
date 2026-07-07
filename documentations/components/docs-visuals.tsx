import {
  ArrowRightLine as ArrowRight,
  Book2Line as BookOpen,
  Box3Line as Boxes,
  BrainLine as Brain,
  CodeLine as Code,
  CylinderLine as Database,
  Dashboard2Line as Gauge,
  DriveLine as HardDrive,
  FileCodeLine as FileCode,
  FlashLine as Zap,
  GitBranchLine as FolderGit2,
  GitBranchLine as GitBranch,
  LayersLine as Layers,
  Message1Line as MessageSquare,
  MonitorLine as Monitor,
  PluginLine as Plug,
  ProcessLine as Workflow,
  RobotLine as Bot,
  RouteLine as Route,
  SafeShieldLine as ShieldCheck,
  SearchLine as Search,
  ServerLine as Server,
  Settings2Line as Settings,
  SitemapLine as ChartNetwork,
  SitemapLine as Network,
  SitemapLine as Waypoints,
  TerminalLine as Terminal,
} from '@mingcute/react'
import Link from 'next/link'
import type { ComponentType, SVGProps } from 'react'

import { cn } from '@/lib/cn'

type VisualTone = 'neutral' | 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'cyan'
type VisualIcon
  = | 'agent'
    | 'api'
    | 'automation'
    | 'book'
    | 'chronicle'
    | 'cli'
    | 'code'
    | 'database'
    | 'desktop'
    | 'docs'
    | 'git'
    | 'graph'
    | 'hardDrive'
    | 'integration'
    | 'layer'
    | 'message'
    | 'model'
    | 'monitoring'
    | 'plugin'
    | 'route'
    | 'search'
    | 'server'
    | 'settings'
    | 'shield'
    | 'terminal'
    | 'workspace'
    | 'zap'

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>

interface VisualCardItem {
  title: string
  description: string
  href?: string
  icon: VisualIcon
  tone?: VisualTone
}

interface FlowItem {
  title: string
  description: string
  icon: VisualIcon
  tone?: VisualTone
}

const iconMap = {
  agent: Bot,
  api: Route,
  automation: Workflow,
  book: BookOpen,
  chronicle: Brain,
  cli: Terminal,
  code: Code,
  database: Database,
  desktop: Monitor,
  docs: FileCode,
  git: GitBranch,
  graph: ChartNetwork,
  hardDrive: HardDrive,
  integration: Network,
  layer: Layers,
  message: MessageSquare,
  model: Boxes,
  monitoring: Gauge,
  plugin: Plug,
  route: Waypoints,
  search: Search,
  server: Server,
  settings: Settings,
  shield: ShieldCheck,
  terminal: Terminal,
  workspace: FolderGit2,
  zap: Zap,
} satisfies Record<VisualIcon, IconComponent>

const toneClasses = {
  neutral: 'border-fd-border bg-fd-card text-fd-foreground',
  blue: 'border-sky-500/25 bg-sky-500/10 text-sky-950 dark:text-sky-100',
  emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-950 dark:text-amber-100',
  rose: 'border-rose-500/25 bg-rose-500/10 text-rose-950 dark:text-rose-100',
  violet: 'border-violet-500/25 bg-violet-500/10 text-violet-950 dark:text-violet-100',
  cyan: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-950 dark:text-cyan-100',
} satisfies Record<VisualTone, string>

const mutedToneClasses = {
  neutral: 'bg-fd-muted text-fd-muted-foreground',
  blue: 'bg-sky-500/15 text-sky-700 dark:text-sky-200',
  emerald: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
  rose: 'bg-rose-500/15 text-rose-700 dark:text-rose-200',
  violet: 'bg-violet-500/15 text-violet-700 dark:text-violet-200',
  cyan: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-200',
} satisfies Record<VisualTone, string>

const productNodes = [
  {
    title: '桌面端',
    description: '启动本地 server，并承担 desktop runtime 的边界。',
    href: '/docs/getting-started/desktop-app',
    icon: 'desktop',
    tone: 'blue',
  },
  {
    title: 'Web workspace',
    description: '组织 Chat、Kanban、workspace files、search 和 settings。',
    href: '/docs/workspace/overview',
    icon: 'workspace',
    tone: 'emerald',
  },
  {
    title: '本地 server',
    description: '拥有 HTTP routes、module lifecycle、OpenAPI 和 background work。',
    href: '/docs/developers/server/overview',
    icon: 'server',
    tone: 'amber',
  },
  {
    title: 'Agent runtime',
    description: '连接 providers、models、tools、skills 和 workspace context。',
    href: '/docs/agents/overview',
    icon: 'agent',
    tone: 'violet',
  },
  {
    title: 'Chronicle',
    description: '捕获本地上下文，并转成 timeline 与 memory。',
    href: '/docs/chronicle/overview',
    icon: 'chronicle',
    tone: 'rose',
  },
  {
    title: 'Plugin layer',
    description: '扩展 server、web、desktop、MCP tools 和 first-party integrations。',
    href: '/docs/developers/plugins/sdk-overview',
    icon: 'plugin',
    tone: 'cyan',
  },
] satisfies VisualCardItem[]

const readerPaths = [
  {
    title: '开始使用',
    description: '安装、打开、添加 workspace，并发出第一条消息。',
    icon: 'book',
    tone: 'blue',
    links: [
      ['入门概览', '/docs/getting-started/overview'],
      ['桌面端', '/docs/getting-started/desktop-app'],
      ['第一个 workspace', '/docs/getting-started/first-workspace'],
    ],
  },
  {
    title: '日常工作',
    description: '使用 Chat、files、Git、Kanban 和 issue agents。',
    icon: 'workspace',
    tone: 'emerald',
    links: [
      ['Composer', '/docs/chat/composer'],
      ['Workspace files', '/docs/workspace/files'],
      ['Issue agents', '/docs/kanban/issue-agents'],
    ],
  },
  {
    title: '管理与运维',
    description: '配置 models、approvals、observability 和 recovery paths。',
    icon: 'settings',
    tone: 'amber',
    links: [
      ['Providers', '/docs/agents/providers'],
      ['Observability', '/docs/operations/observability'],
      ['Troubleshooting', '/docs/troubleshooting'],
    ],
  },
  {
    title: '开发者',
    description: '围绕 owners、namespaces、OpenAPI、CLI 和 plugins 开发。',
    icon: 'code',
    tone: 'violet',
    links: [
      ['开发者概览', '/docs/developers/overview'],
      ['OpenAPI', '/docs/developers/api/openapi'],
      ['Plugin SDK', '/docs/developers/plugins/sdk-overview'],
    ],
  },
] satisfies Array<{
  title: string
  description: string
  icon: VisualIcon
  tone: VisualTone
  links: Array<[string, string]>
}>

const docsGraphClusters = [
  {
    title: '产品界面',
    relation: '使用',
    icon: 'monitoring',
    tone: 'blue',
    links: [
      ['Workspace', '/docs/workspace/overview'],
      ['Chat', '/docs/chat/overview'],
      ['Kanban', '/docs/kanban/overview'],
      ['Automation', '/docs/automation/overview'],
    ],
  },
  {
    title: 'Agent 系统',
    relation: '执行',
    icon: 'agent',
    tone: 'violet',
    links: [
      ['Providers', '/docs/agents/providers'],
      ['Models', '/docs/agents/models'],
      ['Runtime kinds', '/docs/agents/runtime-kinds'],
      ['Skills', '/docs/agents/skills'],
    ],
  },
  {
    title: '本地记忆',
    relation: '记忆',
    icon: 'chronicle',
    tone: 'rose',
    links: [
      ['Chronicle overview', '/docs/chronicle/overview'],
      ['Setup', '/docs/chronicle/setup'],
      ['Memories', '/docs/chronicle/memories'],
      ['Troubleshooting', '/docs/troubleshooting/chronicle'],
    ],
  },
  {
    title: '开发者契约',
    relation: '定义',
    icon: 'code',
    tone: 'emerald',
    links: [
      ['Server', '/docs/developers/server/overview'],
      ['OpenAPI', '/docs/developers/api/openapi'],
      ['Generated CLI', '/docs/developers/cli/generated-cli'],
      ['Database ownership', '/docs/developers/database/ownership'],
    ],
  },
  {
    title: '扩展点',
    relation: '扩展',
    icon: 'plugin',
    tone: 'cyan',
    links: [
      ['Marketplace', '/plugin-marketplace'],
      ['Plugin SDK', '/docs/developers/plugins/sdk-overview'],
      ['Install links', '/docs/developers/plugins/install-links'],
      ['Browser Use', '/docs/developers/plugins/browser-use'],
    ],
  },
  {
    title: '恢复路径',
    relation: '排障',
    icon: 'shield',
    tone: 'amber',
    links: [
      ['Desktop server', '/docs/troubleshooting/desktop-server'],
      ['Provider errors', '/docs/troubleshooting/provider-errors'],
      ['Workspace Git', '/docs/troubleshooting/workspace-git'],
      ['Devtools export', '/docs/troubleshooting/devtools-export'],
    ],
  },
] satisfies Array<{
  title: string
  relation: string
  icon: VisualIcon
  tone: VisualTone
  links: Array<[string, string]>
}>

const developerLayers = [
  {
    title: '组合入口',
    description: 'Elysia app、HTTP foundation、request context 与 OpenAPI exposure。',
    icon: 'server',
    tone: 'amber',
  },
  {
    title: '语义边界',
    description: 'Module owners 定义 routes、errors、schemas 和 persistence boundaries。',
    icon: 'route',
    tone: 'blue',
  },
  {
    title: '契约输出',
    description: 'OpenAPI 驱动 docs、generated CLI、validation 和 client behavior。',
    icon: 'api',
    tone: 'emerald',
  },
  {
    title: '扩展层',
    description: 'Plugin layers 和 desktop hooks 必须留在 owner-scoped namespaces 内。',
    icon: 'plugin',
    tone: 'cyan',
  },
] satisfies FlowItem[]

const agentRuntimeFlow = [
  {
    title: 'Provider',
    description: 'Credentials、health、model discovery 与 runtime-specific settings。',
    icon: 'settings',
    tone: 'blue',
  },
  {
    title: 'Model',
    description: '可选择的 model identity 与 capability expectations。',
    icon: 'model',
    tone: 'emerald',
  },
  {
    title: 'Runtime kind',
    description: '决定任务如何运行的 execution adapter。',
    icon: 'agent',
    tone: 'violet',
  },
  {
    title: 'Workspace context',
    description: 'Agent 可见的 files、Git、issues、approvals 和 tools。',
    icon: 'workspace',
    tone: 'amber',
  },
  {
    title: '使用界面',
    description: 'Chat、issue delegation、automation 或 session await。',
    icon: 'message',
    tone: 'rose',
  },
] satisfies FlowItem[]

const chronicleFlow = [
  {
    title: '捕获',
    description: '本地 screen 或 inbox input 生成 raw context。',
    icon: 'desktop',
    tone: 'blue',
  },
  {
    title: '产物',
    description: 'OCR、files、snapshots 和 metadata 变成可检查资源。',
    icon: 'docs',
    tone: 'emerald',
  },
  {
    title: '过滤',
    description: 'Privacy 和 dedup 在 memory generation 前降低噪音。',
    icon: 'shield',
    tone: 'amber',
  },
  {
    title: '记忆',
    description: '写入 summaries 和 searchable records，供后续检索。',
    icon: 'chronicle',
    tone: 'rose',
  },
  {
    title: '回忆',
    description: 'Timeline 和 memory search 把上下文带回 workspace。',
    icon: 'search',
    tone: 'violet',
  },
] satisfies FlowItem[]

const slackBridgeFlow = [
  {
    title: 'Agent call',
    description: '`zhi` tool 请求 human input。',
    icon: 'agent',
    tone: 'violet',
  },
  {
    title: 'MCP server',
    description: 'stdio process 把请求转发到 bridge socket。',
    icon: 'terminal',
    tone: 'blue',
  },
  {
    title: 'Bridge server',
    description: 'Pending call 在内存中跟踪。',
    icon: 'server',
    tone: 'amber',
  },
  {
    title: 'Slack thread',
    description: 'Bot 发布 thread，并等待回复。',
    icon: 'integration',
    tone: 'cyan',
  },
  {
    title: '恢复执行',
    description: '回复返回 agent，并清理 pending state。',
    icon: 'zap',
    tone: 'emerald',
  },
] satisfies FlowItem[]

const diagnosticRoutes = [
  {
    title: '界面空白或断开连接',
    description: '先检查 desktop process 和 Server Health。',
    href: '/docs/troubleshooting/desktop-server',
    icon: 'server',
    tone: 'rose',
  },
  {
    title: 'Model 或 runtime 失败',
    description: '检查 provider health、model discovery 和 runtime support。',
    href: '/docs/troubleshooting/provider-errors',
    icon: 'agent',
    tone: 'violet',
  },
  {
    title: 'Files 或 Git 看起来不对',
    description: '确认 workspace path、branch、status 和 route scope。',
    href: '/docs/troubleshooting/workspace-git',
    icon: 'git',
    tone: 'emerald',
  },
  {
    title: 'Memory 为空',
    description: '检查 Chronicle status、permissions、snapshots 和 summaries。',
    href: '/docs/troubleshooting/chronicle',
    icon: 'chronicle',
    tone: 'amber',
  },
  {
    title: 'Slack 回复没有返回',
    description: '确认 Socket Mode、channel binding、events 和 MCP socket path。',
    href: '/docs/troubleshooting/slack-bridge',
    icon: 'integration',
    tone: 'cyan',
  },
  {
    title: '需要证据包',
    description: '删除本地状态前，先导出 Devtools data。',
    href: '/docs/troubleshooting/devtools-export',
    icon: 'shield',
    tone: 'blue',
  },
] satisfies VisualCardItem[]

function IconBadge({ icon, tone = 'neutral' }: { icon: VisualIcon, tone?: VisualTone }) {
  const Icon = iconMap[icon]

  return (
    <span
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-md',
        mutedToneClasses[tone],
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
    </span>
  )
}

function VisualCard({ item }: { item: VisualCardItem }) {
  const tone = item.tone ?? 'neutral'
  const body = (
    <>
      <IconBadge icon={item.icon} tone={tone} />
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-6 text-fd-foreground">{item.title}</span>
        <span className="mt-1 block text-sm leading-6 text-fd-muted-foreground">
          {item.description}
        </span>
      </span>
    </>
  )

  if (item.href) {
    return (
      <a
        href={item.href}
        className={cn(
          'group flex min-h-32 gap-3 rounded-lg border p-4 no-underline shadow-sm transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md active:scale-[0.96]',
          toneClasses[tone],
        )}
      >
        {body}
      </a>
    )
  }

  return (
    <div className={cn('flex min-h-32 gap-3 rounded-lg border p-4 shadow-sm', toneClasses[tone])}>
      {body}
    </div>
  )
}

function FlowLane({ items }: { items: FlowItem[] }) {
  return (
    <div className="not-prose my-8 flex flex-col gap-3 md:flex-row md:items-stretch">
      {items.map((item, index) => (
        <div key={item.title} className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row">
          <div
            className={cn(
              'flex min-h-36 flex-1 flex-col gap-3 rounded-lg border p-4 shadow-sm',
              toneClasses[item.tone ?? 'neutral'],
            )}
          >
            <IconBadge icon={item.icon} tone={item.tone} />
            <div>
              <p className="m-0 text-sm font-medium leading-6 text-fd-foreground">{item.title}</p>
              <p className="m-0 mt-1 text-sm leading-6 text-fd-muted-foreground">
                {item.description}
              </p>
            </div>
          </div>
          {index < items.length - 1
? (
            <div className="hidden items-center md:flex">
              <ArrowRight className="size-4 !text-fd-muted-foreground" aria-hidden="true" />
            </div>
          )
: null}
        </div>
      ))}
    </div>
  )
}

export function CradleSystemMap() {
  return (
    <div className="not-prose my-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {productNodes.map(item => (
        <VisualCard key={item.title} item={item} />
      ))}
    </div>
  )
}

export function ReaderPath() {
  return (
    <div className="not-prose my-8 grid gap-3 lg:grid-cols-4">
      {readerPaths.map((path) => {
        const Icon = iconMap[path.icon]

        return (
          <section
            key={path.title}
            className={cn('rounded-lg border p-4 shadow-sm', toneClasses[path.tone])}
          >
            <div className="flex items-start gap-3">
              <IconBadge icon={path.icon} tone={path.tone} />
              <div>
                <h3 className="m-0 text-sm font-medium leading-6 text-fd-foreground">
                  {path.title}
                </h3>
                <p className="m-0 mt-1 text-sm leading-6 text-fd-muted-foreground">
                  {path.description}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {path.links.map(([label, href]) => (
                <a
                  key={href}
                  href={href}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-sm text-fd-foreground no-underline transition-colors duration-150 hover:bg-fd-muted active:scale-[0.96]"
                >
                  <Icon className="size-3.5 text-fd-muted-foreground" aria-hidden="true" />
                  {label}
                </a>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function DocsKnowledgeGraph({ mode = 'full' }: { mode?: 'full' | 'preview' }) {
  const showsMapLink = mode === 'preview'

  return (
    <div className="not-prose my-8">
      <section className="overflow-hidden rounded-lg border border-fd-border bg-fd-card shadow-sm">
        <div className="border-b border-fd-border p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <IconBadge icon="graph" tone="violet" />
              <div>
                <h3 className="m-0 text-base font-semibold leading-7 text-fd-foreground">
                  Cradle 文档关系图
                </h3>
                <p className="m-0 mt-1 text-sm leading-6 text-fd-muted-foreground">
                  先从读者目标进入，再沿 owner、runtime、extension 和 recovery 关系继续阅读。
                </p>
              </div>
            </div>
            {showsMapLink
? (
              <Link
                href="/docs/map"
                className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-md bg-fd-primary px-3 text-sm font-medium text-fd-primary-foreground no-underline transition-[background-color,transform] duration-150 hover:bg-fd-primary/90 active:scale-[0.96]"
              >
                打开完整地图
              </Link>
            )
: null}
          </div>
        </div>
        <div className="divide-y divide-fd-border">
          {docsGraphClusters.map(cluster => (
            <section
              key={cluster.title}
              className="grid gap-3 p-4 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-start"
            >
              <div className="flex items-center gap-2 sm:pt-2">
                <span className="inline-flex rounded-full border border-fd-border bg-fd-background px-2 py-1 text-xs font-medium text-fd-muted-foreground">
                  {cluster.relation}
                </span>
                <span className="hidden h-px flex-1 bg-fd-border sm:block" aria-hidden="true" />
              </div>
              <div className={cn('rounded-lg border p-4 shadow-sm', toneClasses[cluster.tone])}>
                <div className="flex items-start gap-3">
                  <IconBadge icon={cluster.icon} tone={cluster.tone} />
                  <div className="min-w-0">
                    <h3 className="m-0 text-sm font-medium leading-6 text-fd-foreground">
                      {cluster.title}
                    </h3>
                    <div className="mt-3 grid gap-1 sm:grid-cols-2">
                      {cluster.links.map(([label, href]) => (
                        <a
                          key={href}
                          href={href}
                          className="rounded-md px-2 py-1.5 text-sm leading-5 text-fd-muted-foreground no-underline transition-colors duration-150 hover:bg-fd-muted hover:text-fd-foreground"
                        >
                          {label}
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}

export function DeveloperArchitectureMap() {
  return <FlowLane items={developerLayers} />
}

export function AgentRuntimeMap() {
  return <FlowLane items={agentRuntimeFlow} />
}

export function ChroniclePipelineMap() {
  return <FlowLane items={chronicleFlow} />
}

export function SlackBridgeFlow() {
  return <FlowLane items={slackBridgeFlow} />
}

export function DiagnosticRouter() {
  return (
    <div className="not-prose my-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {diagnosticRoutes.map(item => (
        <VisualCard key={item.title} item={item} />
      ))}
    </div>
  )
}

export function OwnerContractMatrix() {
  const rows = [
    ['所有者', '谁拥有语义、迁移、兼容性和错误处理。'],
    ['Namespace', '数据、routes、files 或 capability IDs 位于哪里。'],
    ['生命周期', 'registration、activation、execution、cleanup 和 upgrade 如何发生。'],
    ['接口', 'HTTP routes、CLI commands、plugin APIs、events 和 environment variables。'],
    ['验证', '哪些 tests、type checks、builds 和 smoke checks 能证明行为。'],
    ['边界', '这个能力负责什么、连接什么，以及哪些事情应该交给相邻 owner。'],
  ] satisfies Array<[string, string]>

  return (
    <div className="not-prose my-8 overflow-hidden rounded-lg border border-fd-border shadow-sm">
      <div className="grid bg-fd-muted px-4 py-3 text-xs font-medium uppercase tracking-wide text-fd-muted-foreground sm:grid-cols-[0.8fr_2fr]">
        <div>契约字段</div>
        <div>读者问题</div>
      </div>
      {rows.map(([field, description]) => (
        <div
          key={field}
          className="grid gap-2 border-t border-fd-border bg-fd-card px-4 py-3 text-sm sm:grid-cols-[0.8fr_2fr]"
        >
          <code className="text-fd-foreground">{field}</code>
          <span className="leading-6 text-fd-muted-foreground">{description}</span>
        </div>
      ))}
    </div>
  )
}

export function ApiToCliFlow() {
  const items = [
    {
      title: 'Route owner',
      description: '定义 operation semantics、schema、examples 和 error behavior。',
      icon: 'route',
      tone: 'blue',
    },
    {
      title: 'OpenAPI',
      description: '收集 route metadata，并发布 canonical contract。',
      icon: 'api',
      tone: 'emerald',
    },
    {
      title: 'CLI generator',
      description: '读取 `x-cradle-cli`，并写入 generated command files。',
      icon: 'terminal',
      tone: 'amber',
    },
    {
      title: 'Runtime command',
      description: '格式化 flags、发送 HTTP requests，并渲染 output。',
      icon: 'cli',
      tone: 'violet',
    },
  ] satisfies FlowItem[]

  return <FlowLane items={items} />
}

export function PluginLayerMap() {
  const items = [
    {
      title: 'Manifest',
      description: 'Package metadata 声明 layers、capabilities、permissions 和 entrypoints。',
      icon: 'docs',
      tone: 'blue',
    },
    {
      title: 'Host descriptor',
      description: 'Cradle 校验 metadata，并创建 route 与 capability identities。',
      icon: 'server',
      tone: 'amber',
    },
    {
      title: 'Layer activation',
      description: 'Server、web 和 desktop layers 只在对应 host 存在时激活。',
      icon: 'layer',
      tone: 'cyan',
    },
    {
      title: 'Capability use',
      description: 'Routes、commands、panels、hooks 和 MCP tools 在 owner boundaries 内运行。',
      icon: 'plugin',
      tone: 'violet',
    },
  ] satisfies FlowItem[]

  return <FlowLane items={items} />
}

export function LocalFirstBoundaryMap() {
  const items = [
    {
      title: '本地数据',
      description: 'Workspace、server state、logs、Chronicle artifacts 和 generated files。',
      href: '/docs/operations/desktop-server',
      icon: 'hardDrive',
      tone: 'blue',
    },
    {
      title: '外部 providers',
      description: 'Model APIs、Slack、MCP hosts 和 browser automation endpoints。',
      href: '/docs/agents/providers',
      icon: 'integration',
      tone: 'amber',
    },
    {
      title: '显式 bridge',
      description: 'Approvals、session awaits、Slack bridge 和 plugin permissions。',
      href: '/docs/chat/approvals',
      icon: 'shield',
      tone: 'emerald',
    },
  ] satisfies VisualCardItem[]

  return (
    <div className="not-prose my-8 grid gap-3 md:grid-cols-3">
      {items.map(item => (
        <VisualCard key={item.title} item={item} />
      ))}
    </div>
  )
}
