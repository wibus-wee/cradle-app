import CradleAPI
import SwiftUI

struct SessionListView: View {
    let sessions: [CradleSession]
    let selection: String?
    let isLoading: Bool
    let onSelect: @MainActor @Sendable (String?) -> Void
    let onRefresh: @MainActor @Sendable () async -> Void

    var body: some View {
        List(selection: Binding(get: { selection }, set: onSelect)) {
            ForEach(sessions) { session in
                SessionRow(session: session)
                    .tag(Optional(session.id))
            }
        }
        .refreshable(action: onRefresh)
        .overlay {
            if isLoading && sessions.isEmpty {
                ProgressView("载入会话…")
            } else if sessions.isEmpty {
                EmptyStateView(
                    symbol: "text.bubble",
                    title: "暂无会话",
                    message: "这个工作区还没有可显示的会话。"
                )
            }
        }
    }
}

private struct SessionRow: View {
    let session: CradleSession

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if session.isUnread {
                    Circle().fill(.indigo).frame(width: 7, height: 7)
                }
                Text(session.title)
                    .font(.body.weight(session.isUnread ? .semibold : .regular))
                    .lineLimit(2)
                Spacer(minLength: 4)
                if session.isRunning {
                    ProgressView().controlSize(.small)
                }
            }
            HStack {
                Label(session.runtimeKind, systemImage: "cpu")
                Spacer()
                Text(session.updatedAt, style: .relative)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 5)
    }
}
