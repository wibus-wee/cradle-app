import CradleAPI
import SwiftUI

struct MainView: View {
    let workspaces: [CradleWorkspace]
    let sessions: [CradleSession]
    let messages: [CradleMessage]
    let selectedWorkspaceID: String?
    let selectedSessionID: String?
    let sessionTitle: String?
    let isLoading: Bool
    let isStreaming: Bool
    let onSelectWorkspace: @MainActor @Sendable (String?) -> Void
    let onSelectSession: @MainActor @Sendable (String?) -> Void
    let onSend: @MainActor @Sendable (String) -> Void
    let onCancel: @MainActor @Sendable () -> Void
    let onRefresh: @MainActor @Sendable () async -> Void
    let onDisconnect: @MainActor @Sendable () -> Void

    var body: some View {
        NavigationSplitView {
            WorkspaceListView(
                workspaces: workspaces,
                selection: selectedWorkspaceID,
                onSelect: onSelectWorkspace,
                onDisconnect: onDisconnect
            )
            .navigationTitle("Cradle")
        } content: {
            SessionListView(
                sessions: sessions,
                selection: selectedSessionID,
                isLoading: isLoading,
                onSelect: onSelectSession,
                onRefresh: onRefresh
            )
            .navigationTitle("会话")
        } detail: {
            if selectedSessionID != nil {
                ChatView(
                    title: sessionTitle ?? "会话",
                    messages: messages,
                    isLoading: isLoading,
                    isStreaming: isStreaming,
                    onSend: onSend,
                    onCancel: onCancel
                )
            } else {
                EmptyStateView(
                    symbol: "bubble.left.and.bubble.right",
                    title: "选择一个会话",
                    message: "从侧栏中选择会话以查看消息并继续控制 Agent。"
                )
            }
        }
        .navigationSplitViewStyle(.balanced)
    }
}
