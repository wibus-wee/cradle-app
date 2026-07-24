export const DESKTOP_SERVER_STATUS_GET_CHANNEL = 'desktop-server:get-status'
export const DESKTOP_SERVER_STATUS_CHANGED_CHANNEL = 'desktop-server:status-changed'

export type DesktopServerStatus
  = | { state: 'starting' }
    | { state: 'migrating', phase: string }
    | { state: 'compacting' }
    | { state: 'ready', serverUrl: string }
    | { state: 'failed', message: string }
