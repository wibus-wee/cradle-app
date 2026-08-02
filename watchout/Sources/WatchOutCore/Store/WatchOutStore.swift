import Algorithms
import Foundation
import GRDB
import IdentifiedCollections

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

  public static func databaseURL() throws -> URL {
    try applicationSupportDirectory().appendingPathComponent("watchout.sqlite")
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
    migrator.registerMigration("v2_attention_items_fts5") { db in
      // External-content FTS5 + sync triggers + backfill of existing rows.
      try db.create(virtualTable: "attention_items_fts", using: FTS5()) { table in
        table.synchronize(withTable: AttentionItem.databaseTableName)
        table.tokenizer = .unicode61()
        table.column("title")
        table.column("body")
        table.column("source")
        table.column("href")
      }
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
      try Self.fetch(db, query: query)
    }
  }

  public func snapshot(_ query: AttentionListQuery = .init()) throws -> AttentionSnapshot {
    try dbQueue.read { db in
      let items = try Self.fetch(db, query: query)
      let openCount = try AttentionItem
        .filter(AttentionItem.Columns.status == AttentionItem.Status.open.rawValue)
        .fetchCount(db)
      return AttentionSnapshot(items: items, openCount: openCount)
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
  public func update(id: String, _ patch: AttentionItemUpdate) throws -> AttentionItem {
    try mutate(id: id) { item in
      if let title = patch.title {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw WatchOutStoreError.invalidTitle }
        item.title = trimmed
      }
      if let body = patch.body {
        item.body = body?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
      }
      if let href = patch.href {
        item.href = href?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
      }
      if let source = patch.source {
        item.source = source.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? item.source
      }
      if let audience = patch.audience {
        item.audience = audience
      }
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
    _ = try deleteReturning(id: id)
  }

  /// Deletes and returns the removed row so callers can offer undo / restore.
  @discardableResult
  public func deleteReturning(id: String) throws -> AttentionItem {
    try dbQueue.write { db in
      guard let item = try AttentionItem.fetchOne(db, key: id) else {
        throw WatchOutStoreError.notFound(id)
      }
      try AttentionItem.deleteOne(db, key: id)
      return item
    }
  }

  /// Re-inserts a previously deleted item (same id). Fails if the id already exists.
  @discardableResult
  public func restore(_ item: AttentionItem) throws -> AttentionItem {
    try dbQueue.write { db in
      if try AttentionItem.fetchOne(db, key: item.id) != nil {
        throw WatchOutStoreError.database("Item already exists: \(item.id)")
      }
      try item.insert(db)
      return item
    }
  }

  public func exportJSON() throws -> Data {
    let items = try list(.init(status: nil, limit: nil))
    let encoder = JSONEncoder.watchOut
    return try encoder.encode(items)
  }

  @discardableResult
  public func importJSON(_ data: Data, replace: Bool = false) throws -> Int {
    let decoder = JSONDecoder.watchOut
    let decoded = try decoder.decode([AttentionItem].self, from: data)
    // Keep the first occurrence per id when a dump contains duplicates.
    let items = Array(decoded.uniqued(on: \.id))
    return try dbQueue.write { db in
      if replace {
        try AttentionItem.deleteAll(db)
      }
      for item in items {
        try item.save(db)
      }
      return items.count
    }
  }

  /// Same-process observation via GRDB `ValueObservation`.
  public func observeSnapshot(
    _ query: AttentionListQuery = .init()
  ) -> AsyncThrowingStream<AttentionSnapshot, Error> {
    let observation = ValueObservation.tracking { db in
      let items = try Self.fetch(db, query: query)
      let openCount = try AttentionItem
        .filter(AttentionItem.Columns.status == AttentionItem.Status.open.rawValue)
        .fetchCount(db)
      return AttentionSnapshot(items: items, openCount: openCount)
    }

    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          for try await value in observation.values(in: dbQueue) {
            continuation.yield(value)
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  /// Detect writes from other processes (CLI / MCP) via `PRAGMA data_version`.
  public func observeExternalDataVersion(
    pollInterval nanoseconds: UInt64 = 800_000_000
  ) -> AsyncStream<Int> {
    AsyncStream { continuation in
      let task = Task {
        var last = try? self.dataVersion()
        while !Task.isCancelled {
          try? await Task.sleep(nanoseconds: nanoseconds)
          let current = try? self.dataVersion()
          if let current, current != last {
            last = current
            continuation.yield(current)
          }
        }
        continuation.finish()
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  /// Live snapshots for the app: GRDB observation + cross-process `data_version` polling.
  public func observe(
    _ query: AttentionListQuery = .init(),
    externalPollNanoseconds: UInt64 = 800_000_000
  ) -> AsyncStream<AttentionSnapshot> {
    AsyncStream { continuation in
      let task = Task {
        if let initial = try? self.snapshot(query) {
          continuation.yield(initial)
        }

        await withTaskGroup(of: Void.self) { group in
          group.addTask {
            do {
              for try await value in self.observeSnapshot(query) {
                guard !Task.isCancelled else { return }
                continuation.yield(value)
              }
            } catch {
              // Observation ended; external poll may still refresh.
            }
          }
          group.addTask {
            for await _ in self.observeExternalDataVersion(pollInterval: externalPollNanoseconds) {
              guard !Task.isCancelled else { return }
              if let snap = try? self.snapshot(query) {
                continuation.yield(snap)
              }
            }
          }
          await group.next()
          group.cancelAll()
        }
        continuation.finish()
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }

  public func dataVersion() throws -> Int {
    try dbQueue.read { db in
      try Int.fetchOne(db, sql: "PRAGMA data_version") ?? 0
    }
  }

  private func mutate(id: String, _ body: (inout AttentionItem) throws -> Void) throws -> AttentionItem {
    try dbQueue.write { db in
      guard var item = try AttentionItem.fetchOne(db, key: id) else {
        throw WatchOutStoreError.notFound(id)
      }
      try body(&item)
      try item.update(db)
      return item
    }
  }

  private static func fetch(_ db: Database, query: AttentionListQuery) throws -> [AttentionItem] {
    if let search = query.search?.trimmingCharacters(in: .whitespacesAndNewlines), !search.isEmpty {
      return try fetchFTS(db, query: query, search: search)
    }

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

  private static func fetchFTS(
    _ db: Database,
    query: AttentionListQuery,
    search: String
  ) throws -> [AttentionItem] {
    // Prefer GRDB's safe pattern builder over concatenating user MATCH strings.
    guard let pattern = FTS5Pattern(matchingAllPrefixesIn: search) else {
      return []
    }

    var sql = """
      SELECT attention_items.*
      FROM attention_items
      JOIN attention_items_fts
        ON attention_items_fts.rowid = attention_items.rowid
      WHERE attention_items_fts MATCH ?
      """
    var arguments = StatementArguments()
    arguments += pattern

    if let status = query.status {
      sql += " AND attention_items.status = ?"
      arguments += status.rawValue
    }
    if let audience = query.audience {
      sql += " AND attention_items.audience = ?"
      arguments += audience.rawValue
    }

    sql += " ORDER BY rank, attention_items.createdAt DESC"
    if let limit = query.limit {
      sql += " LIMIT ?"
      arguments += limit
    }

    return try AttentionItem.fetchAll(db, sql: sql, arguments: arguments)
  }
}

private extension String {
  var nilIfEmpty: String? {
    isEmpty ? nil : self
  }
}

public extension JSONEncoder {
  static let watchOut: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    encoder.dateEncodingStrategy = .iso8601
    return encoder
  }()
}

public extension JSONDecoder {
  static let watchOut: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return decoder
  }()
}
