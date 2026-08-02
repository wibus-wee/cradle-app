import XCTest
import WatchOutCore

final class WatchOutStoreTests: XCTestCase {
  func testCreateListCompleteReopen() throws {
    let store = try WatchOutStore.makeInMemory()

    let created = try store.create(
      AttentionItemCreate(
        title: "Review PR",
        body: "Diff looks big",
        href: "https://example.com/pr/1",
        source: "test",
        audience: .human
      )
    )
    XCTAssertEqual(created.status, .open)
    XCTAssertEqual(try store.openCount(), 1)

    let listed = try store.list(.init(status: .open))
    XCTAssertEqual(listed.count, 1)
    XCTAssertEqual(listed[0].title, "Review PR")

    let done = try store.complete(id: created.id)
    XCTAssertEqual(done.status, .done)
    XCTAssertEqual(try store.openCount(), 0)
    XCTAssertEqual(try store.list(.init(status: .open)).count, 0)
    XCTAssertEqual(try store.list(.init(status: .done)).count, 1)

    let reopened = try store.reopen(id: created.id)
    XCTAssertEqual(reopened.status, .open)
    XCTAssertNil(reopened.completedAt)
  }

  func testRejectsEmptyTitle() throws {
    let store = try WatchOutStore.makeInMemory()
    XCTAssertThrowsError(try store.create(AttentionItemCreate(title: "   "))) { error in
      XCTAssertEqual(error as? WatchOutStoreError, .invalidTitle)
    }
  }

  func testUpdateAndGet() throws {
    let store = try WatchOutStore.makeInMemory()
    let created = try store.create(AttentionItemCreate(title: "Park me", body: "old"))

    let updated = try store.update(
      id: created.id,
      AttentionItemUpdate(
        title: "Parked",
        body: .some("new body"),
        href: .some("https://example.com"),
        source: "edited",
        audience: .agent
      )
    )
    XCTAssertEqual(updated.title, "Parked")
    XCTAssertEqual(updated.body, "new body")
    XCTAssertEqual(updated.href, "https://example.com")
    XCTAssertEqual(updated.source, "edited")
    XCTAssertEqual(updated.audience, .agent)

    let cleared = try store.update(
      id: created.id,
      AttentionItemUpdate(body: .some(nil), href: .some(nil))
    )
    XCTAssertNil(cleared.body)
    XCTAssertNil(cleared.href)

    let fetched = try store.get(id: created.id)
    XCTAssertEqual(fetched?.title, "Parked")
  }

  func testSearchMatchesTitleBodySourceHref() throws {
    let store = try WatchOutStore.makeInMemory()
    _ = try store.create(
      AttentionItemCreate(title: "Alpha ticket", body: "details about zebra", source: "manual")
    )
    _ = try store.create(
      AttentionItemCreate(title: "Beta", href: "https://example.com/zebra-run", source: "agent")
    )
    _ = try store.create(
      AttentionItemCreate(title: "Gamma", source: "zebra-bot")
    )
    _ = try store.create(
      AttentionItemCreate(title: "Unrelated", body: "nope")
    )

    let hits = try store.list(.init(status: nil, search: "zebra"))
    XCTAssertEqual(hits.count, 3)
    XCTAssertTrue(hits.allSatisfy { item in
      [item.title, item.body ?? "", item.source, item.href ?? ""]
        .joined(separator: " ")
        .localizedCaseInsensitiveContains("zebra")
    })
  }

  func testFTSPrefixSearch() throws {
    let store = try WatchOutStore.makeInMemory()
    _ = try store.create(AttentionItemCreate(title: "notification redesign"))
    _ = try store.create(AttentionItemCreate(title: "notify agents"))
    _ = try store.create(AttentionItemCreate(title: "unrelated"))

    let hits = try store.list(.init(status: nil, search: "notif"))
    XCTAssertEqual(hits.count, 2)
  }

  func testExportImportRoundTrip() throws {
    let store = try WatchOutStore.makeInMemory()
    let a = try store.create(AttentionItemCreate(title: "One", body: "a"))
    _ = try store.complete(id: a.id)
    _ = try store.create(AttentionItemCreate(title: "Two", href: "https://example.com"))

    let data = try store.exportJSON()

    let other = try WatchOutStore.makeInMemory()
    let count = try other.importJSON(data, replace: true)
    XCTAssertEqual(count, 2)
    XCTAssertEqual(try other.list(.init(status: nil)).count, 2)
    XCTAssertEqual(try other.openCount(), 1)
  }

  func testImportDedupesById() throws {
    let store = try WatchOutStore.makeInMemory()
    let id = "fixed-id"
    let first = AttentionItem(id: id, title: "First", source: "a")
    let second = AttentionItem(id: id, title: "Second", source: "b")
    let encoder = JSONEncoder.watchOut
    let data = try encoder.encode([first, second])

    let count = try store.importJSON(data, replace: true)
    XCTAssertEqual(count, 1)
    XCTAssertEqual(try store.get(id: id)?.title, "First")
  }

  func testSnapshotOpenCount() throws {
    let store = try WatchOutStore.makeInMemory()
    let open = try store.create(AttentionItemCreate(title: "Open"))
    _ = try store.create(AttentionItemCreate(title: "Also open"))
    _ = try store.complete(id: open.id)

    let snap = try store.snapshot(.init(status: .open))
    XCTAssertEqual(snap.items.count, 1)
    XCTAssertEqual(snap.openCount, 1)
    XCTAssertEqual(snap.items[id: snap.items.ids[0]]?.title, "Also open")
  }

  func testDeleteMissingThrows() throws {
    let store = try WatchOutStore.makeInMemory()
    XCTAssertThrowsError(try store.delete(id: "missing")) { error in
      XCTAssertEqual(error as? WatchOutStoreError, .notFound("missing"))
    }
  }

  func testDeleteReturningAndRestore() throws {
    let store = try WatchOutStore.makeInMemory()
    let created = try store.create(AttentionItemCreate(title: "Undo me", body: "keep"))
    let removed = try store.deleteReturning(id: created.id)
    XCTAssertEqual(try store.openCount(), 0)
    XCTAssertNil(try store.get(id: created.id))

    let restored = try store.restore(removed)
    XCTAssertEqual(restored.id, created.id)
    XCTAssertEqual(restored.title, "Undo me")
    XCTAssertEqual(try store.openCount(), 1)

    XCTAssertThrowsError(try store.restore(removed)) { error in
      XCTAssertEqual(
        error as? WatchOutStoreError,
        .database("Item already exists: \(created.id)")
      )
    }
  }
}
