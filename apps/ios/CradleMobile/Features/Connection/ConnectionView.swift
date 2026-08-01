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
            Form {
                Section {
                    TextField("Server URL", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .textContentType(.URL)
                    SecureField("访问令牌（可选）", text: $token)
                        .textInputAutocapitalization(.never)
                } header: {
                    Text("Cradle Server")
                } footer: {
                    Text("使用这台设备能够访问的 HTTPS、Tailscale 或局域网地址。令牌只保存在系统 Keychain。")
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.red)
                    }
                }

                Section {
                    Button {
                        onConnect(.init(serverURL: serverURL, token: token))
                    } label: {
                        HStack {
                            Spacer()
                            if isConnecting {
                                ProgressView()
                            }
                            Text(isConnecting ? "正在连接…" : "连接")
                            Spacer()
                        }
                    }
                    .disabled(isConnecting || serverURL.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .navigationTitle("连接 Cradle")
            .navigationBarTitleDisplayMode(.large)
        }
    }
}
