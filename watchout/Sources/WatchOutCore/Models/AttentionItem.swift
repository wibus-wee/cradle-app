import Foundation
import IdentifiedCollections

/// Minimal Attention Object — a parking slip, not a workflow ticket.
public struct AttentionItem: Codable, Hashable, Identifiable, Sendable {
  public enum Status: String, Codable, Hashable, Sendable, CaseIterable {
    case open
    case done
  }

  public enum Audience: String, Codable, Hashable, Sendable, CaseIterable {
    case human
    case agent
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

public struct AttentionItemUpdate: Sendable {
  public var title: String?
  public var body: String??
  public var href: String??
  public var source: String?
  public var audience: AttentionItem.Audience?

  public init(
    title: String? = nil,
    body: String?? = nil,
    href: String?? = nil,
    source: String? = nil,
    audience: AttentionItem.Audience? = nil
  ) {
    self.title = title
    self.body = body
    self.href = href
    self.source = source
    self.audience = audience
  }
}

public struct AttentionListQuery: Sendable, Hashable {
  public var status: AttentionItem.Status?
  public var audience: AttentionItem.Audience?
  public var search: String?
  public var limit: Int?

  public init(
    status: AttentionItem.Status? = .open,
    audience: AttentionItem.Audience? = nil,
    search: String? = nil,
    limit: Int? = nil
  ) {
    self.status = status
    self.audience = audience
    self.search = search
    self.limit = limit
  }
}

public struct AttentionSnapshot: Sendable, Hashable {
  public var items: IdentifiedArrayOf<AttentionItem>
  public var openCount: Int

  public init(items: [AttentionItem], openCount: Int) {
    self.items = IdentifiedArrayOf(uniqueElements: items)
    self.openCount = openCount
  }
}
