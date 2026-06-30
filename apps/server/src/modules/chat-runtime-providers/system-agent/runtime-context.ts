/**
 * Output: System Agent runtime filesystem roots.
 * Input: Cradle server data-dir configuration.
 * Position: System Agent provider package runtime context owner.
 */

import path from 'node:path'

import { getServerConfig } from '../../../infra'

export interface SystemAgentRuntimeContext {
  dataDir: string
  sessionsRootDir: string
  jarvisWorkspaceRoot: string
}

export function resolveSystemAgentRuntimeContext(): SystemAgentRuntimeContext {
  const serverCfg = getServerConfig()
  const dataDir = serverCfg.dataDir ?? path.join(process.cwd(), 'data')
  return {
    dataDir,
    sessionsRootDir: path.join(dataDir, 'jar-sessions'),
    jarvisWorkspaceRoot: path.join(dataDir, 'jarvis-workspace'),
  }
}
