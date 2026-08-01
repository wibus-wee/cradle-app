import CradleAPI
import Foundation

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var credentials: ConnectionCredentials?
    @Published private(set) var workspaces: [CradleWorkspace] = []
    @Published private(set) var sessions: [CradleSession] = []
    @Published private(set) var messages: [CradleMessage] = []
    @Published var selectedWorkspaceID: String?
    @Published var selectedSessionID: String?
    @Published private(set) var isConnecting = false
    @Published private(set) var isLoading = false
    @Published private(set) var isStreaming = false
    @Published var errorMessage: String?

    private let connectionStore = ConnectionStore()
    private var service: CradleService?
    private var streamTask: Task<Void, Never>?

    init() {
        guard let saved = connectionStore.load() else { return }
        Task { await connect(saved) }
    }

    var selectedSession: CradleSession? {
        sessions.first { $0.id == selectedSessionID }
    }

    func connect(_ newCredentials: ConnectionCredentials) async {
        guard let url = normalizedURL(from: newCredentials.serverURL) else {
            errorMessage = "请输入有效的 Cradle Server URL"
            return
        }

        isConnecting = true
        errorMessage = nil
        defer { isConnecting = false }

        do {
            let newService = CradleService(serverURL: url, token: newCredentials.token)
            try await newService.healthCheck()
            let normalized = ConnectionCredentials(serverURL: url.absoluteString, token: newCredentials.token)
            try connectionStore.save(normalized)
            service = newService
            credentials = normalized
            try await loadWorkspaces()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func disconnect() {
        streamTask?.cancel()
        try? connectionStore.clear()
        credentials = nil
        service = nil
        workspaces = []
        sessions = []
        messages = []
        selectedWorkspaceID = nil
        selectedSessionID = nil
    }

    func loadWorkspaces() async throws {
        guard let service else { return }
        isLoading = true
        defer { isLoading = false }
        workspaces = try await service.workspaces()
        if selectedWorkspaceID == nil {
            selectedWorkspaceID = workspaces.first(where: \.isAvailable)?.id ?? workspaces.first?.id
        }
        await selectWorkspace(selectedWorkspaceID)
    }

    func selectWorkspace(_ workspaceID: String?) async {
        guard let service else { return }
        selectedWorkspaceID = workspaceID
        selectedSessionID = nil
        messages = []
        isLoading = true
        defer { isLoading = false }
        do {
            sessions = try await service.sessions(workspaceID: workspaceID)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectSession(_ sessionID: String?) async {
        guard let service, let sessionID else { return }
        selectedSessionID = sessionID
        isLoading = true
        defer { isLoading = false }
        do {
            messages = try await service.messages(sessionID: sessionID)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refresh() async {
        let sessionID = selectedSessionID
        do {
            try await loadWorkspaces()
            if let sessionID, sessions.contains(where: { $0.id == sessionID }) {
                await selectSession(sessionID)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func send(_ text: String) {
        guard let service, let sessionID = selectedSessionID else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isStreaming else { return }

        let userMessage = CradleMessage(id: UUID().uuidString, role: .user, content: trimmed, isStreaming: false)
        let assistantID = UUID().uuidString
        messages.append(userMessage)
        messages.append(CradleMessage(id: assistantID, role: .assistant, content: "", isStreaming: true))
        isStreaming = true

        streamTask = Task {
            do {
                for try await event in service.sendMessage(sessionID: sessionID, text: trimmed) {
                    switch event {
                    case .textDelta(let delta):
                        append(delta, to: assistantID)
                    case .finished:
                        finishStreamingMessage(assistantID)
                    }
                }
                finishStreamingMessage(assistantID)
                messages = try await service.messages(sessionID: sessionID)
            } catch is CancellationError {
                finishStreamingMessage(assistantID)
            } catch {
                finishStreamingMessage(assistantID)
                errorMessage = error.localizedDescription
            }
            isStreaming = false
        }
    }

    func cancel() async {
        guard let service, let selectedSessionID else { return }
        streamTask?.cancel()
        do {
            try await service.cancel(sessionID: selectedSessionID)
        } catch {
            errorMessage = error.localizedDescription
        }
        isStreaming = false
        await selectSession(selectedSessionID)
    }

    private func append(_ text: String, to messageID: String) {
        guard let index = messages.firstIndex(where: { $0.id == messageID }) else { return }
        let message = messages[index]
        messages[index] = CradleMessage(
            id: message.id,
            role: message.role,
            content: message.content + text,
            isStreaming: true
        )
    }

    private func finishStreamingMessage(_ messageID: String) {
        guard let index = messages.firstIndex(where: { $0.id == messageID }) else { return }
        let message = messages[index]
        messages[index] = CradleMessage(
            id: message.id,
            role: message.role,
            content: message.content,
            isStreaming: false
        )
    }

    private func normalizedURL(from value: String) -> URL? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let withScheme = trimmed.contains("://") ? trimmed : "http://\(trimmed)"
        guard var components = URLComponents(string: withScheme), components.host != nil else { return nil }
        components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return components.url
    }
}
