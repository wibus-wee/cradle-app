import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

public enum CradleAPI {
    public static func client(
        serverURL: URL,
        token: String?
    ) -> Client {
        Client(
            serverURL: serverURL,
            transport: URLSessionTransport(),
            middlewares: [BearerAuthenticationMiddleware(token: token)]
        )
    }
}

private struct BearerAuthenticationMiddleware: ClientMiddleware {
    let token: String?

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        if let token, !token.isEmpty {
            request.headerFields[.authorization] = "Bearer \(token)"
        }
        return try await next(request, body, baseURL)
    }
}
