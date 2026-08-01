import SwiftUI

struct ComposerView: View {
    @Binding var draft: String
    let isStreaming: Bool
    let onSend: @MainActor @Sendable () -> Void
    let onCancel: @MainActor @Sendable () -> Void

    @State private var editorHeight: CGFloat = 40

    var body: some View {
        HStack(alignment: .bottom, spacing: 10) {
            GrowingTextView(
                text: $draft,
                measuredHeight: $editorHeight,
                placeholder: "向 Cradle 发送消息…",
                onSubmit: onSend
            )
            .frame(height: min(max(editorHeight, 40), 132))
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

            Button {
                if isStreaming {
                    onCancel()
                } else {
                    onSend()
                }
            } label: {
                Image(systemName: isStreaming ? "stop.fill" : "arrow.up")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(isStreaming ? Color.red : Color.indigo, in: Circle())
            }
            .disabled(!isStreaming && draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityLabel(isStreaming ? "停止生成" : "发送")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
    }
}
