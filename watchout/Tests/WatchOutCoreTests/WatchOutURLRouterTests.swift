import XCTest
import WatchOutCore

final class WatchOutURLRouterTests: XCTestCase {
  func testParsePark() {
    let url = URL(string: "watchout://park?title=Review%20PR&body=notes&href=https://example.com&source=cradle&audience=human")!
    guard case .park(let input) = WatchOutURLRouter.parse(url) else {
      return XCTFail("expected park")
    }
    XCTAssertEqual(input.title, "Review PR")
    XCTAssertEqual(input.body, "notes")
    XCTAssertEqual(input.href, "https://example.com")
    XCTAssertEqual(input.source, "cradle")
    XCTAssertEqual(input.audience, .human)
  }

  func testParseItemQueryAndPath() {
    let query = URL(string: "watchout://item?id=abc-123")!
    XCTAssertEqual(WatchOutURLRouter.parse(query), .item(id: "abc-123"))

    let path = URL(string: "watchout://item/abc-123")!
    XCTAssertEqual(WatchOutURLRouter.parse(path), .item(id: "abc-123"))
  }

  func testParseShow() {
    XCTAssertEqual(WatchOutURLRouter.parse(URL(string: "watchout://show")!), .show)
  }

  func testRejectsOtherSchemesAndMissingTitle() {
    XCTAssertNil(WatchOutURLRouter.parse(URL(string: "https://example.com")!))
    XCTAssertNil(WatchOutURLRouter.parse(URL(string: "watchout://park?body=only")!))
  }

  func testBuildersRoundTrip() {
    let park = WatchOutURLRouter.parkURL(title: "Hello", body: "World", source: "test")!
    guard case .park(let input) = WatchOutURLRouter.parse(park) else {
      return XCTFail("expected park")
    }
    XCTAssertEqual(input.title, "Hello")
    XCTAssertEqual(input.body, "World")
    XCTAssertEqual(input.source, "test")

    let item = WatchOutURLRouter.itemURL(id: "id-1")!
    XCTAssertEqual(WatchOutURLRouter.parse(item), .item(id: "id-1"))
  }
}
