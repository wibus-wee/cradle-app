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
}
