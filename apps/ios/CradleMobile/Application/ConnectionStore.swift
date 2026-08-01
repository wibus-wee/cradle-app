import Foundation
import KeychainAccess

struct ConnectionCredentials: Equatable, Sendable {
    var serverURL: String
    var token: String
}

final class ConnectionStore: @unchecked Sendable {
    private let keychain = Keychain(service: "app.cradle.mobile.server")
        .accessibility(.afterFirstUnlock)
    private let defaults = UserDefaults.standard

    func load() -> ConnectionCredentials? {
        guard let serverURL = defaults.string(forKey: "serverURL"), !serverURL.isEmpty else {
            return nil
        }
        return ConnectionCredentials(serverURL: serverURL, token: (try? keychain.get("token")) ?? "")
    }

    func save(_ credentials: ConnectionCredentials) throws {
        defaults.set(credentials.serverURL, forKey: "serverURL")
        try keychain.set(credentials.token, key: "token")
    }

    func clear() throws {
        defaults.removeObject(forKey: "serverURL")
        try keychain.remove("token")
    }
}
