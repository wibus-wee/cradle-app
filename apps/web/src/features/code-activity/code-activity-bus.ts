import type { Disposable } from '@cradle/plugin-sdk'
import type { CodeActivityEvent, CodeActivityHandler } from '@cradle/plugin-sdk/web'

export type CodeActivityTarget = Omit<CodeActivityEvent, 'kind' | 'occurredAt' | 'isWrite'>

interface CodeActivitySubscriber {
  owner: string
  handler: CodeActivityHandler
}

function targetsEqual(a: CodeActivityTarget | null, b: CodeActivityTarget | null): boolean {
  return a?.workspace.id === b?.workspace.id
    && a?.workspace.name === b?.workspace.name
    && a?.file.relativePath === b?.file.relativePath
    && a?.file.language === b?.file.language
}

export class CodeActivityBus {
  private currentTarget: CodeActivityTarget | null = null
  private readonly subscribers = new Map<symbol, CodeActivitySubscriber>()

  setCurrentTarget(target: CodeActivityTarget | null): void {
    if (targetsEqual(this.currentTarget, target)) {
      return
    }

    this.currentTarget = target
    if (target) {
      this.dispatch(this.createHeartbeat(target, false))
    }
  }

  clear(): void {
    this.currentTarget = null
  }

  recordWrite(workspaceId: string, relativePath: string): void {
    const target = this.currentTarget
    if (
      !target
      || target.workspace.id !== workspaceId
      || target.file.relativePath !== relativePath
    ) {
      return
    }
    this.publishWrite(target)
  }

  publishWrite(target: CodeActivityTarget, occurredAt = Date.now()): void {
    this.dispatch(this.createHeartbeat(target, true, occurredAt))
  }

  subscribe(owner: string, handler: CodeActivityHandler): Disposable {
    const key = Symbol(owner)
    this.subscribers.set(key, { owner, handler })
    if (this.currentTarget) {
      this.invoke({ owner, handler }, this.createHeartbeat(this.currentTarget, false))
    }
    return {
      dispose: () => {
        this.subscribers.delete(key)
      },
    }
  }

  private createHeartbeat(
    target: CodeActivityTarget,
    isWrite: boolean,
    occurredAt = Date.now(),
  ): CodeActivityEvent {
    return {
      kind: 'code.heartbeat',
      occurredAt,
      workspace: { ...target.workspace },
      file: { ...target.file },
      isWrite,
    }
  }

  private dispatch(event: CodeActivityEvent): void {
    for (const subscriber of this.subscribers.values()) {
      this.invoke(subscriber, event)
    }
  }

  private invoke(subscriber: CodeActivitySubscriber, event: CodeActivityEvent): void {
    try {
      Promise.resolve(subscriber.handler(event)).catch((error) => {
        console.error('[code-activity] handler failed', { owner: subscriber.owner, error })
      })
    }
    catch (error) {
      console.error('[code-activity] handler failed', { owner: subscriber.owner, error })
    }
  }
}

export const codeActivityBus = new CodeActivityBus()

export function recordCodeActivityWrite(workspaceId: string, relativePath: string): void {
  codeActivityBus.recordWrite(workspaceId, relativePath)
}
