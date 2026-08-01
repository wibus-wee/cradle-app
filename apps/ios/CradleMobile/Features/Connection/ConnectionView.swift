import SwiftUI

struct ConnectionView: View {
    let isConnecting: Bool
    let errorMessage: String?
    let onConnect: @MainActor @Sendable (ConnectionCredentials) -> Void

    @State private var serverURL: String
    @State private var token: String

    init(
        initialCredentials: ConnectionCredentials,
        isConnecting: Bool,
        errorMessage: String?,
        onConnect: @escaping @MainActor @Sendable (ConnectionCredentials) -> Void
    ) {
        self.isConnecting = isConnecting
        self.errorMessage = errorMessage
        self.onConnect = onConnect
        _serverURL = State(initialValue: initialCredentials.serverURL)
        _token = State(initialValue: initialCredentials.token)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 12) {
                        Image(systemName: "shippingbox.fill")
                            .font(.system(size: 54, weight: .semibold))
                            .foregroundStyle(.indigo.gradient)
                            .accessibilityHidden(true)
                        Text("连接 Cradle")
                            .font(.largeTitle.bold())
                        Text("在 iPhone 或 iPad 上查看工作区、继续会话并控制正在运行的 Agent。")
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }

                    VStack(alignment: .leading, spacing: 18) {
                        LabeledContent("Server URL") {
                            TextField("https://cradle.example.com", text: $serverURL)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .keyboardType(.URL)
                                .multilineTextAlignment(.trailing)
                        }
                        Divider()
                        LabeledContent("访问令牌") {
                            SecureField("可选", text: $token)
                                .textInputAutocapitalization(.never)
                                .multilineTextAlignment(.trailing)
                        }
                    }
                    .padding(20)
                    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))

                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button {
                        onConnect(.init(serverURL: serverURL, token: token))
                    } label: {
                        HStack {
                            if isConnecting { ProgressView().tint(.white) }
                            Text(isConnecting ? "正在连接…" : "连接 Server")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.indigo)
                    .disabled(isConnecting || serverURL.trimmingCharacters(in: .whitespaces).isEmpty)

                    Text("令牌只保存在系统 Keychain。建议通过 HTTPS、Tailscale 或可信局域网连接。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: 560)
                .padding(.horizontal, 24)
                .padding(.vertical, 48)
                .frame(maxWidth: .infinity)
            }
            .background(Color(uiColor: .systemGroupedBackground))
        }
    }
}
