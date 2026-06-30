import { shallow } from 'zustand/shallow'
import { createWithEqualityFn } from 'zustand/traditional'

import type { RuntimeKind } from '~/features/agent-runtime/types'

export interface SessionLayoutRecord {
  sessionId: string
  sessionTitle: string | null
  workspaceId: string | null
  workspacePath: string | null
  runtimeKind: RuntimeKind | null
}

export interface WorkspaceLayoutRecord {
  workspaceId: string
  workspaceName: string | null
  workspacePath: string | null
}

interface SessionLayoutState {
  sessions: Record<string, SessionLayoutRecord>
  workspaces: Record<string, WorkspaceLayoutRecord>
  upsertSession: (record: Partial<Omit<SessionLayoutRecord, 'sessionId'>> & { sessionId: string }) => void
  upsertSessions: (records: Array<Partial<Omit<SessionLayoutRecord, 'sessionId'>> & { sessionId: string }>) => void
  upsertWorkspace: (record: Partial<Omit<WorkspaceLayoutRecord, 'workspaceId'>> & { workspaceId: string }) => void
  upsertWorkspaces: (records: Array<Partial<Omit<WorkspaceLayoutRecord, 'workspaceId'>> & { workspaceId: string }>) => void
}

function mergeSessionLayoutRecord(
  current: SessionLayoutRecord | undefined,
  patch: Partial<Omit<SessionLayoutRecord, 'sessionId'>> & { sessionId: string },
): SessionLayoutRecord {
  return {
    sessionId: patch.sessionId,
    sessionTitle: 'sessionTitle' in patch ? patch.sessionTitle ?? null : current?.sessionTitle ?? null,
    workspaceId: 'workspaceId' in patch ? patch.workspaceId ?? null : current?.workspaceId ?? null,
    workspacePath: 'workspacePath' in patch ? patch.workspacePath ?? null : current?.workspacePath ?? null,
    runtimeKind: 'runtimeKind' in patch ? patch.runtimeKind ?? null : current?.runtimeKind ?? null,
  }
}

function mergeWorkspaceLayoutRecord(
  current: WorkspaceLayoutRecord | undefined,
  patch: Partial<Omit<WorkspaceLayoutRecord, 'workspaceId'>> & { workspaceId: string },
): WorkspaceLayoutRecord {
  return {
    workspaceId: patch.workspaceId,
    workspaceName: 'workspaceName' in patch ? patch.workspaceName ?? null : current?.workspaceName ?? null,
    workspacePath: 'workspacePath' in patch ? patch.workspacePath ?? null : current?.workspacePath ?? null,
  }
}

function areSessionLayoutRecordsEqual(
  left: SessionLayoutRecord | undefined,
  right: SessionLayoutRecord,
): boolean {
  return !!left
    && left.sessionId === right.sessionId
    && left.sessionTitle === right.sessionTitle
    && left.workspaceId === right.workspaceId
    && left.workspacePath === right.workspacePath
    && left.runtimeKind === right.runtimeKind
}

function areWorkspaceLayoutRecordsEqual(
  left: WorkspaceLayoutRecord | undefined,
  right: WorkspaceLayoutRecord,
): boolean {
  return !!left
    && left.workspaceId === right.workspaceId
    && left.workspaceName === right.workspaceName
    && left.workspacePath === right.workspacePath
}

export const useSessionLayoutStore = createWithEqualityFn<SessionLayoutState>()(set => ({
  sessions: {},
  workspaces: {},

  upsertSession: (record) => {
    set((state) => {
      const nextRecord = mergeSessionLayoutRecord(state.sessions[record.sessionId], record)
      if (areSessionLayoutRecordsEqual(state.sessions[record.sessionId], nextRecord)) {
        return state
      }

      return {
        sessions: {
          ...state.sessions,
          [record.sessionId]: nextRecord,
        },
      }
    })
  },

  upsertSessions: (records) => {
    if (records.length === 0) {
      return
    }

    set((state) => {
      let changed = false
      const sessions = { ...state.sessions }
      for (const record of records) {
        const nextRecord = mergeSessionLayoutRecord(sessions[record.sessionId], record)
        if (!areSessionLayoutRecordsEqual(sessions[record.sessionId], nextRecord)) {
          sessions[record.sessionId] = nextRecord
          changed = true
        }
      }
      return changed ? { sessions } : state
    })
  },

  upsertWorkspace: (record) => {
    set((state) => {
      const nextRecord = mergeWorkspaceLayoutRecord(state.workspaces[record.workspaceId], record)
      if (areWorkspaceLayoutRecordsEqual(state.workspaces[record.workspaceId], nextRecord)) {
        return state
      }

      return {
        workspaces: {
          ...state.workspaces,
          [record.workspaceId]: nextRecord,
        },
      }
    })
  },

  upsertWorkspaces: (records) => {
    if (records.length === 0) {
      return
    }

    set((state) => {
      let changed = false
      const workspaces = { ...state.workspaces }
      for (const record of records) {
        const nextRecord = mergeWorkspaceLayoutRecord(workspaces[record.workspaceId], record)
        if (!areWorkspaceLayoutRecordsEqual(workspaces[record.workspaceId], nextRecord)) {
          workspaces[record.workspaceId] = nextRecord
          changed = true
        }
      }
      return changed ? { workspaces } : state
    })
  },
}), shallow)
