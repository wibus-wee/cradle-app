import Foundation
import SSE

public struct CradleWorkspace: Identifiable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let path: String
    public let branch: String?
    public let isAvailable: Bool

    public init(id: String, name: String, path: String, branch: String?, isAvailable: Bool) {
        self.id = id
        self.name = name
        self.path = path
        self.branch = branch
        self.isAvailable = isAvailable
    }
}

public struct CradleSession: Identifiable, Hashable, Sendable {
    public let id: String
    public let workspaceID: String?
    public let title: String
    public let runtimeKind: String
    public let isUnread: Bool
    public let isRunning: Bool
    public let updatedAt: Date

    public init(
        id: String,
        workspaceID: String?,
        title: String,
        runtimeKind: String,
        isUnread: Bool,
        isRunning: Bool,
        updatedAt: Date
    ) {
        self.id = id
        self.workspaceID = workspaceID
        self.title = title
        self.runtimeKind = runtimeKind
        self.isUnread = isUnread
        self.isRunning = isRunning
        self.updatedAt = updatedAt
    }
}

public struct CradleMessage: Identifiable, Hashable, Sendable {
    public enum Role: String, Hashable, Sendable {
        case user
        case assistant
    }

    public let id: String
    public let role: Role
    public let content: String
    public let isStreaming: Bool

    public init(id: String, role: Role, content: String, isStreaming: Bool) {
        self.id = id
        self.role = role
        self.content = content
        self.isStreaming = isStreaming
    }
}

public enum CradleStreamEvent: Hashable, Sendable {
    case textDelta(String)
    case finished
}

public enum CradleServiceError: LocalizedError {
    case unexpectedResponse(Int?)

    public var errorDescription: String? {
        switch self {
        case .unexpectedResponse(let status):
            status.map { "Cradle Server 返回了意外状态码：\($0)" } ?? "Cradle Server 返回了意外响应"
        }
    }
}

public final class CradleService: @unchecked Sendable {
    private let client: Client

    public init(serverURL: URL, token: String?) {
        client = CradleAPI.client(serverURL: serverURL, token: token)
    }

    public func healthCheck() async throws {
        let output = try await client.getHealth(.init())
        guard case .ok = output else {
            throw CradleServiceError.unexpectedResponse(output.statusCode)
        }
    }

    public func workspaces() async throws -> [CradleWorkspace] {
        let output = try await client.getWorkspaces(.init())
        let payload = try output.ok.body.json
        return payload.map {
            CradleWorkspace(
                id: $0.id,
                name: $0.name,
                path: $0.locator.path,
                branch: $0.gitIdentity.branch,
                isAvailable: $0.availability == .available
            )
        }
    }

    public func sessions(workspaceID: String?) async throws -> [CradleSession] {
        let input = Operations.getSessions.Input(query: .init(workspaceId: workspaceID))
        let output = try await client.getSessions(input)
        let payload = try output.ok.body.json
        return payload.map {
            CradleSession(
                id: $0.id,
                workspaceID: $0.workspaceId,
                title: $0.title ?? "未命名会话",
                runtimeKind: $0.runtimeKind,
                isUnread: $0.unread,
                isRunning: $0.status.rawValue == "streaming",
                updatedAt: Date(timeIntervalSince1970: $0.updatedAt / 1_000)
            )
        }
    }

    public func messages(sessionID: String) async throws -> [CradleMessage] {
        let input = Operations.getChatSessionsBySessionIdMessages.Input(
            path: .init(sessionId: sessionID),
            query: .init(limit: 200)
        )
        let output = try await client.getChatSessionsBySessionIdMessages(input)
        let payload = try output.ok.body.json
        return payload.rows.compactMap { row in
            let role: CradleMessage.Role = row.role == .user ? .user : .assistant
            return CradleMessage(
                id: row.messageId,
                role: role,
                content: row.preview,
                isStreaming: row.status.rawValue == "streaming"
            )
        }
    }

    public func sendMessage(sessionID: String, text: String) -> AsyncThrowingStream<CradleStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let input = Operations.postChatSessionsBySessionIdResponse.Input(
                        path: .init(sessionId: sessionID),
                        body: .json(.init(text: text))
                    )
                    let output = try await client.postChatSessionsBySessionIdResponse(input)
                    let body = try output.ok.body.text_event_hyphen_stream
                    var parser = Parser()
                    for try await bytes in body {
                        parser.consume(bytes)
                        while let event = parser.nextEvent() {
                            if event.data == "[DONE]" {
                                continuation.yield(.finished)
                                continuation.finish()
                                return
                            }
                            guard let data = event.data.data(using: .utf8) else { continue }
                            let chunk = try JSONDecoder().decode(UIMessageChunk.self, from: data)
                            if chunk.type == "text-delta", let delta = chunk.delta {
                                continuation.yield(.textDelta(delta))
                            }
                        }
                    }
                    continuation.yield(.finished)
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    public func cancel(sessionID: String) async throws {
        let input = Operations.postChatSessionsBySessionIdCancel.Input(path: .init(sessionId: sessionID))
        let output = try await client.postChatSessionsBySessionIdCancel(input)
        guard case .ok = output else {
            throw CradleServiceError.unexpectedResponse(output.statusCode)
        }
    }
}

private struct UIMessageChunk: Decodable {
    let type: String
    let delta: String?
}

private extension Operations.getHealth.Output {
    var statusCode: Int? {
        if case .undocumented(let statusCode, _) = self { statusCode } else { nil }
    }
}

private extension Operations.postChatSessionsBySessionIdCancel.Output {
    var statusCode: Int? {
        if case .undocumented(let statusCode, _) = self { statusCode } else { nil }
    }
}
