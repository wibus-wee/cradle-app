import Foundation

/// Minimal Attention Object — a parking slip, not a workflow ticket.
public struct AttentionItem: Codable, Hashable, Identifiable, Sendable {
  public enum Status: String, Codable, Hashable, Sendable, CaseIterable {
    case open
    case done
  }

  public enum Audience: String, Codable, Hashable, Sendable, CaseIterable {
    /// Intended for a human to review / act on later.
    case human
    /// Agent-owned checklist style item.
    case agent
    /// Either may act; complete policy is still caller-defined.
    case any
  }

  public var id: String
  public var title: String
  public var body: String?
  public var href: String?
  public var source: String
  public var audience: Audience
  public var status: Status
  public var createdAt: Date
  public var completedAt: Date?

  public init(
    id: String = UUID().uuidString.lowercased(),
    title: String,
    body: String? = nil,
    href: String? = nil,
    source: String = "manual",
    audience: Audience = .human,
    status: Status = .open,
    createdAt: Date = .now,
    completedAt: Date? = nil
  ) {
    self.id = id
    self.title = title
    self.body = body
    self.href = href
    self.source = source
    self.audience = audience
    self.status = status
    self.createdAt = createdAt
    self.completedAt = completedAt
  }
}

public struct AttentionItemCreate: Sendable {
  public var title: String
  public var body: String?
  public var href: String?
  public var source: String
  public var audience: AttentionItem.Audience

  public init(
    title: String,
    body: String? = nil,
    href: String? = nil,
    source: String = "manual",
    audience: AttentionItem.Audience = .human
  ) {
    self.title = title
    self.body = body
    self.href = href
    self.source = source
    self.audience = audience
  }
}

public struct AttentionListQuery: Sendable {
  public var status: AttentionItem.Status?
  public var audience: AttentionItem.Audience?
  public var limit: Int?

  public init(
    status: AttentionItem.Status? = .open,
    audience: AttentionItem.Audience? = nil,
    limit: Int? = nil
  ) {
    self.status = status
    self.audience = audience
    self.limit = limit
  }
}
