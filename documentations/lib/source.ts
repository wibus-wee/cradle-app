import {
  BracesLine,
  ChipLine,
  CodeLine,
  CylinderLine,
  DashboardLine,
  GitPullRequestLine,
  HistoryLine,
  LayoutLine,
  LifebuoyLine,
  Link2Line,
  Message1Line,
  MonitorLine,
  PluginLine,
  ProcessLine,
  RobotLine,
  RocketLine,
  ServerLine,
  Settings2Line,
  TerminalLine,
} from '@mingcute/react'
import { docs } from 'collections/server'
import { loader } from 'fumadocs-core/source'
import { createElement } from 'react'

import { docsContentRoute, docsImageRoute, docsRoute } from './shared'

const sourceIconMap = {
  Bot: RobotLine,
  Braces: BracesLine,
  Cable: Link2Line,
  Code: CodeLine,
  Cpu: ChipLine,
  Database: CylinderLine,
  GitPullRequest: GitPullRequestLine,
  History: HistoryLine,
  Kanban: DashboardLine,
  LifeBuoy: LifebuoyLine,
  MessageSquare: Message1Line,
  Monitor: MonitorLine,
  PanelsTopLeft: LayoutLine,
  Plug: PluginLine,
  Rocket: RocketLine,
  Server: ServerLine,
  Settings: Settings2Line,
  Terminal: TerminalLine,
  Workflow: ProcessLine,
} satisfies Record<string, typeof CodeLine>

function resolveSourceIcon(icon?: string) {
  if (!icon) { return undefined }

  const Icon = sourceIconMap[icon as keyof typeof sourceIconMap]

  return Icon ? createElement(Icon, { 'aria-hidden': true }) : undefined
}

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: docsRoute,
  source: docs.toFumadocsSource(),
  icon: resolveSourceIcon,
})

export function getPageImage(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'image.png']

  return {
    segments,
    url: `${docsImageRoute}/${segments.join('/')}`,
  }
}

export function getPageMarkdownUrl(page: (typeof source)['$inferPage']) {
  const segments = [...page.slugs, 'content.md']

  return {
    segments,
    url: `${docsContentRoute}/${segments.join('/')}`,
  }
}

export async function getLLMText(page: (typeof source)['$inferPage']) {
  const processed = await page.data.getText('processed')

  return `# ${page.data.title} (${page.url})

${processed}`
}
