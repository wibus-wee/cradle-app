import CradleAPI
import MarkdownView
import SwiftUI

struct ChatView: View {
    let title: String
    let messages: [CradleMessage]
    let isLoading: Bool
    let isStreaming: Bool
    let onSend: @MainActor @Sendable (String) -> Void
    let onCancel: @MainActor @Sendable () -> Void

    @State private var draft = ""

    var body: some View {
        VStack(spacing: 0) {
            transcript
            Divider()
            ComposerView(
                draft: $draft,
                isStreaming: isStreaming,
                onSend: submit,
                onCancel: onCancel
            )
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .background(Color(uiColor: .systemGroupedBackground))
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 18) {
                    ForEach(messages) { message in
                        MessageView(message: message)
                            .id(message.id)
                    }
                    if isLoading && messages.isEmpty {
                        ProgressView("载入消息…").padding(.top, 44)
                    }
                }
                .frame(maxWidth: 780)
                .padding(.horizontal, 16)
                .padding(.vertical, 22)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messages.last?.content) { _ in
                guard let id = messages.last?.id else { return }
                withAnimation(.easeOut(duration: 0.18)) {
                    proxy.scrollTo(id, anchor: .bottom)
                }
            }
        }
    }

    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        onSend(text)
    }
}

private struct MessageView: View {
    let message: CradleMessage

    var body: some View {
        HStack(alignment: .top) {
            if message.role == .user { Spacer(minLength: 48) }
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 7) {
                    Image(systemName: message.role == .user ? "person.crop.circle.fill" : "sparkles")
                    Text(message.role == .user ? "你" : "Cradle")
                        .font(.caption.weight(.semibold))
                    if message.isStreaming {
                        ProgressView().controlSize(.mini)
                    }
                }
                .foregroundStyle(.secondary)

                if message.role == .assistant {
                    MarkdownView(message.content.isEmpty ? "…" : message.content)
                        .textSelection(.enabled)
                } else {
                    Text(message.content)
                        .textSelection(.enabled)
                }
            }
            .padding(message.role == .user ? 14 : 0)
            .background {
                if message.role == .user {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color.indigo.opacity(0.12))
                }
            }
            if message.role == .assistant { Spacer(minLength: 28) }
        }
        .frame(maxWidth: .infinity)
    }
}
