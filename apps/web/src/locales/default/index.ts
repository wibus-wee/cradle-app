import agentManagement from './agent-management'
import automation from './automation'
import awaits from './awaits'
import chat from './chat'
import chrome from './chrome'
import chronicle from './chronicle'
import common from './common'
import devtool from './devtool'
import diffReview from './diff-review'
import editor from './editor'
import filesystem from './filesystem'
import git from './git'
import home from './home'
import kanban from './kanban'
import newChat from './new-chat'
import onboarding from './onboarding'
import pullRequests from './pull-requests'
import resourcesPage from './resources'
import runtimes from './runtimes'
import search from './search'
import sessionIsolation from './session-isolation'
import sessionPullRequest from './session-pull-request'
import settings from './settings'
import skills from './skills'
import systemAgent from './system-agent'
import usage from './usage'
import work from './work'
import workspace from './workspace'

const resources = {
  agentManagement,
  awaits,
  automation,
  chat,
  chronicle,
  chrome,
  common,
  devtool,
  'diff-review': diffReview,
  editor,
  filesystem,
  git,
  home,
  kanban,
  'new-chat': newChat,
  onboarding,
  'pull-requests': pullRequests,
  'resources': resourcesPage,
  runtimes,
  search,
  'session-isolation': sessionIsolation,
  'session-pull-request': sessionPullRequest,
  settings,
  skills,
  'system-agent': systemAgent,
  usage,
  workspace,
  work,
} as const

export type DefaultResources = typeof resources
export type Namespace = keyof DefaultResources

export const allNamespaces = Object.keys(resources) as Namespace[]

export default resources
