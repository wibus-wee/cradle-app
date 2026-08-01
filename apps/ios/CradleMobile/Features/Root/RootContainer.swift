import SwiftUI

struct RootContainer: View {
    @ObservedObject var model: AppModel

    var body: some View {
        Group {
            if model.credentials == nil {
                ConnectionView(
                    initialCredentials: .init(serverURL: "http://localhost:21423", token: ""),
                    isConnecting: model.isConnecting,
                    errorMessage: model.errorMessage,
                    onConnect: { credentials in
                        Task { await model.connect(credentials) }
                    }
                )
            } else {
                MainView(
                    workspaces: model.workspaces,
                    sessions: model.sessions,
                    messages: model.messages,
                    selectedWorkspaceID: model.selectedWorkspaceID,
                    selectedSessionID: model.selectedSessionID,
                    sessionTitle: model.selectedSession?.title,
                    isLoading: model.isLoading,
                    isStreaming: model.isStreaming,
                    onSelectWorkspace: { id in Task { await model.selectWorkspace(id) } },
                    onSelectSession: { id in Task { await model.selectSession(id) } },
                    onSend: model.send,
                    onCancel: { Task { await model.cancel() } },
                    onRefresh: { await model.refresh() },
                    onDisconnect: model.disconnect
                )
            }
        }
        .alert(
            "连接出错",
            isPresented: Binding(
                get: { model.credentials != nil && model.errorMessage != nil },
                set: { if !$0 { model.errorMessage = nil } }
            ),
            actions: { Button("好") { model.errorMessage = nil } },
            message: { Text(model.errorMessage ?? "未知错误") }
        )
    }
}
