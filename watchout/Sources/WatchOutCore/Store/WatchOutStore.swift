import Foundation
import GRDB

extension AttentionItem: FetchableRecord, PersistableRecord {
  public static let databaseTableName = "attention_items"

  enum Columns {
    static let id = Column(CodingKeys.id)
    static let title = Column(CodingKeys.title)
    static let body = Column(CodingKeys.body)
    static let href = Column(CodingKeys.href)
    static let source = Column(CodingKeys.source)
    static let audience = Column(CodingKeys.audience)
    static let status = Column(CodingKeys.status)
    static let createdAt = Column(CodingKeys.createdAt)
    static let completedAt = Column(CodingKeys.completedAt)
  }
}

public enum WatchOutStoreError: Error, LocalizedError, Sendable, Equatable {
  case notFound(String)
  case invalidTitle
  case database(String)

  public var errorDescription: String? {
    switch self {
    case .notFound(let id):
      return "Item not found: \(id)"
    case .invalidTitle:
      return "Title must not be empty"
    case .database(let message):
      return message
    }
  }
}

/// Local Attention Object Store. Owns open/done parking slips only.
public final class WatchOutStore: Sendable {
  private let dbQueue: DatabaseQueue

  public init(dbQueue: DatabaseQueue) throws {
    self.dbQueue = dbQueue
    try Self.migrate(dbQueue)
  }

  /// Default on-disk location: `~/Library/Application Support/WatchOut/watchout.sqlite`
  public static func makeDefault() throws -> WatchOutStore {
    let root = try applicationSupportDirectory()
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let url = root.appendingPathComponent("watchout.sqlite")
    var config = Configuration()
    config.prepareDatabase { db in
      try db.execute(sql: "PRAGMA foreign_keys = ON")
    }
    let queue = try DatabaseQueue(path: url.path, configuration: config)
    return try WatchOutStore(dbQueue: queue)
  }

  public static func makeInMemory() throws -> WatchOutStore {
    try WatchOutStore(dbQueue: DatabaseQueue())
  }

  public static func applicationSupportDirectory() throws -> URL {
    let base = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    )
    return base.appendingPathComponent("WatchOut", isDirectory: true)
  }

  private static func migrate(_ dbQueue: DatabaseQueue) throws {
    var migrator = DatabaseMigrator()
    migrator.registerMigration("v1_attention_items") { db in
      try db.create(table: AttentionItem.databaseTableName) { table in
        table.primaryKey("id", .text)
        table.column("title", .text).notNull()
        table.column("body", .text)
        table.column("href", .text)
        table.column("source", .text).notNull()
        table.column("audience", .text).notNull()
        table.column("status", .text).notNull().defaults(to: AttentionItem.Status.open.rawValue)
        table.column("createdAt", .datetime).notNull()
        table.column("completedAt", .datetime)
      }
      try db.create(
        index: "attention_items_status_created",
        on: AttentionItem.databaseTableName,
        columns: ["status", "createdAt"]
      )
    }
    try migrator.migrate(dbQueue)
  }

  @discardableResult
  public func create(_ input: AttentionItemCreate) throws -> AttentionItem {
    let title = input.title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty else { throw WatchOutStoreError.invalidTitle }

    let item = AttentionItem(
      title: title,
      body: input.body?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
      href: input.href?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
      source: input.source.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? "manual",
      audience: input.audience,
      status: .open,
      createdAt: .now,
      completedAt: nil
    )

    try dbQueue.write { db in
      try item.insert(db)
    }
    return item
  }

  public func get(id: String) throws -> AttentionItem? {
    try dbQueue.read { db in
      try AttentionItem.fetchOne(db, key: id)
    }
  }

  public func list(_ query: AttentionListQuery = .init()) throws -> [AttentionItem] {
    try dbQueue.read { db in
      var request = AttentionItem.all()
      if let status = query.status {
        request = request.filter(AttentionItem.Columns.status == status.rawValue)
      }
      if let audience = query.audience {
        request = request.filter(AttentionItem.Columns.audience == audience.rawValue)
      }
      request = request.order(AttentionItem.Columns.createdAt.desc)
      if let limit = query.limit {
        request = request.limit(limit)
      }
      return try request.fetchAll(db)
    }
  }

  public func openCount() throws -> Int {
    try dbQueue.read { db in
      try AttentionItem
        .filter(AttentionItem.Columns.status == AttentionItem.Status.open.rawValue)
        .fetchCount(db)
    }
  }

  @discardableResult
  public func complete(id: String) throws -> AttentionItem {
    try mutate(id: id) { item in
      guard item.status != .done else { return }
      item.status = .done
      item.completedAt = .now
    }
  }

  @discardableResult
  public func reopen(id: String) throws -> AttentionItem {
    try mutate(id: id) { item in
      guard item.status != .open else { return }
      item.status = .open
      item.completedAt = nil
    }
  }

  public func delete(id: String) throws {
    let deleted = try dbQueue.write { db in
      try AttentionItem.deleteOne(db, key: id)
    }
    guard deleted else { throw WatchOutStoreError.notFound(id) }
  }

  private func mutate(id: String, _ body: (inout AttentionItem) -> Void) throws -> AttentionItem {
    try dbQueue.write { db in
      guard var item = try AttentionItem.fetchOne(db, key: id) else {
        throw WatchOutStoreError.notFound(id)
      }
      body(&item)
      try item.update(db)
      return item
    }
  }
}

private extension String {
  var nilIfEmpty: String? {
    isEmpty ? nil : self
  }
}
