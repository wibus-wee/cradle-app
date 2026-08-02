import Foundation

/// Deep links for parking / focusing Attention items.
///
/// Examples:
/// - `watchout://park?title=Review%20PR&body=…&href=…&source=cradle`
/// - `watchout://item?id=<uuid>`
/// - `watchout://item/<uuid>`
/// - `watchout://show`
public enum WatchOutDeepLink: Equatable, Sendable {
  case park(AttentionItemCreate)
  case item(id: String)
  case show
}

public enum WatchOutURLRouter {
  public static let scheme = "watchout"

  public static func parse(_ url: URL) -> WatchOutDeepLink? {
    guard url.scheme?.lowercased() == scheme else { return nil }

    let host = (url.host ?? "").lowercased()
    let pathParts = url.path
      .split(separator: "/", omittingEmptySubsequences: true)
      .map { String($0) }
    let queryItems = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []

    func query(_ name: String) -> String? {
      queryItems.first(where: { $0.name == name })?.value?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        .nilIfEmpty
    }

    // Prefer host as action; fall back to first path segment (watchout:///park?…).
    let action = host.isEmpty ? (pathParts.first?.lowercased() ?? "show") : host
    let remainingPath = host.isEmpty ? Array(pathParts.dropFirst()) : pathParts

    switch action {
    case "park", "create":
      guard let title = query("title") else { return nil }
      let audience = query("audience").flatMap(AttentionItem.Audience.init(rawValue:)) ?? .human
      return .park(
        AttentionItemCreate(
          title: title,
          body: query("body"),
          href: query("href"),
          source: query("source") ?? "url",
          audience: audience
        )
      )

    case "item", "open":
      let id = query("id") ?? remainingPath.first
      guard let id, !id.isEmpty else { return nil }
      return .item(id: id)

    case "show", "float":
      return .show

    default:
      return nil
    }
  }

  public static func parkURL(
    title: String,
    body: String? = nil,
    href: String? = nil,
    source: String = "url",
    audience: AttentionItem.Audience = .human
  ) -> URL? {
    var components = URLComponents()
    components.scheme = scheme
    components.host = "park"
    var query: [URLQueryItem] = [
      URLQueryItem(name: "title", value: title),
      URLQueryItem(name: "source", value: source),
      URLQueryItem(name: "audience", value: audience.rawValue),
    ]
    if let body, !body.isEmpty {
      query.append(URLQueryItem(name: "body", value: body))
    }
    if let href, !href.isEmpty {
      query.append(URLQueryItem(name: "href", value: href))
    }
    components.queryItems = query
    return components.url
  }

  public static func itemURL(id: String) -> URL? {
    var components = URLComponents()
    components.scheme = scheme
    components.host = "item"
    components.queryItems = [URLQueryItem(name: "id", value: id)]
    return components.url
  }

  public static func showURL() -> URL {
    URL(string: "\(scheme)://show")!
  }
}

private extension String {
  var nilIfEmpty: String? {
    isEmpty ? nil : self
  }
}
