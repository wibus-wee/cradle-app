import {
  REMOTE_AGENT_PROTOCOL_VERSION,
  remoteAgentStreamMethods,
  remoteAgentUnaryMethods,
  type RemoteAgentMethod,
  type RemoteAgentStreamMethod,
  type RemoteAgentUnaryMethod,
} from '@cradle/remote-agent-protocol'

import { AgentRegistry } from './agents'
import { listDirectory, probeRepository, readTextFile, statPath } from './filesystem'
import { PtyRegistry } from './pty'
import { readHostId } from './host-id'
import { listWorkspaces } from './workspaces'

const DAEMON_VERSION = '0.1.0'

export interface AgentdDaemonOptions {
  homeDir: string
}

export class AgentdDaemon {
  private readonly startedAt = Date.now()
  private readonly agents: AgentRegistry
  private readonly ptys = new PtyRegistry()
  private readonly hostId: string

  constructor(private readonly options: AgentdDaemonOptions) {
    this.hostId = readHostId(options.homeDir)
    this.agents = new AgentRegistry()
  }

  async handleUnary(method: RemoteAgentUnaryMethod, params: unknown): Promise<unknown> {
    switch (method) {
      case 'host/hello':
        return {
          protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
          daemonVersion: DAEMON_VERSION,
          hostId: this.hostId,
          platform: process.platform,
          arch: process.arch,
          supportedMethods: this.supportedMethods(),
        }
      case 'host/health':
        return {
          status: 'ok',
          daemonVersion: DAEMON_VERSION,
          hostId: this.hostId,
          uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
        }
      case 'runtime/list':
        return {
          runtimes: [
            {
              runtimeKind: 'mock-remote',
              label: 'Remote Mock',
              status: 'available',
              detail: null,
            },
          ],
        }
      case 'workspace/list':
        return listWorkspaces(params)
      case 'fs/listDirectory':
        return await listDirectory(params)
      case 'fs/stat':
        return await statPath(params)
      case 'fs/readFile':
        return await readTextFile(params)
      case 'git/probeRepository':
        return await probeRepository(params)
      case 'agent/list':
        return this.agents.list()
      case 'agent/start':
        return this.agents.start(params)
      case 'agent/attach':
        return this.agents.attach(params)
      case 'agent/cancel':
        return this.agents.cancel(params)
      case 'agent/steer':
        return this.agents.steer(params)
      case 'pty/write':
        return this.ptys.write(params)
      case 'pty/resize':
        return this.ptys.resize(params)
      case 'pty/close':
        return this.ptys.close(params)
    }
  }

  handleStream(method: RemoteAgentStreamMethod, params: unknown): AsyncGenerator<unknown, void, void> {
    switch (method) {
      case 'agent/turn':
        return this.agents.turn(params)
      case 'pty/open':
        return this.ptys.open(params)
    }
  }

  private supportedMethods(): RemoteAgentMethod[] {
    return [...remoteAgentUnaryMethods, ...remoteAgentStreamMethods]
  }
}
