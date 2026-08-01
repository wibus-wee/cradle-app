import CradleAPI
import SwiftUI

struct WorkspaceListView: View {
    let workspaces: [CradleWorkspace]
    let selection: String?
    let onSelect: @MainActor @Sendable (String?) -> Void
    let onDisconnect: @MainActor @Sendable () -> Void

    var body: some View {
        List(selection: Binding(get: { selection }, set: onSelect)) {
            Section("工作区") {
                ForEach(workspaces) { workspace in
                    WorkspaceRow(workspace: workspace)
                        .tag(Optional(workspace.id))
                        .disabled(!workspace.isAvailable)
                }
            }
        }
        .overlay {
            if workspaces.isEmpty {
                EmptyStateView(
                    symbol: "folder.badge.questionmark",
                    title: "没有工作区",
                    message: "请先在 Cradle Desktop 或 CLI 中添加工作区。"
                )
            }
        }
        .toolbar {
            ToolbarItem(placement: .bottomBar) {
                Button("断开连接", systemImage: "rectangle.portrait.and.arrow.right", action: onDisconnect)
                    .foregroundStyle(.red)
            }
        }
    }
}

private struct WorkspaceRow: View {
    let workspace: CradleWorkspace

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: workspace.isAvailable ? "folder.fill" : "folder.badge.minus")
                .foregroundStyle(workspace.isAvailable ? .indigo : .secondary)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(workspace.name)
                    .font(.body.weight(.medium))
                    .lineLimit(1)
                Text(workspace.branch ?? workspace.path)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
    }
}
