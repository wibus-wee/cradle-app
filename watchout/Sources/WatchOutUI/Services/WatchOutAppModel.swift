#if canImport(AppKit)
import AppKit
#endif
import Dependencies
import Foundation
import Observation
import WatchOutCore

@MainActor
@Observable
public final class WatchOutAppModel {
  public private(set) var items: [AttentionItem] = []
  public private(set) var openCount: Int = 0
  public var draftTitle: String = ""
  public var errorMessage: String?
  public var isFloatingPresented: Bool = false
  public var showDone: Bool = false

  @ObservationIgnored
  @Dependency(\.watchOutStore) private var store

  public init() {}

  public func refresh() {
    do {
      let status: AttentionItem.Status? = showDone ? nil : .open
      items = try store.list(AttentionListQuery(status: status, limit: 200))
      openCount = try store.openCount()
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func createFromDraft(source: String = "app") {
    let title = draftTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty else { return }
    do {
      _ = try store.create(
        AttentionItemCreate(
          title: title,
          source: source,
          audience: .human
        )
      )
      draftTitle = ""
      refresh()
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func complete(_ item: AttentionItem) {
    do {
      _ = try store.complete(id: item.id)
      refresh()
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func reopen(_ item: AttentionItem) {
    do {
      _ = try store.reopen(id: item.id)
      refresh()
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func delete(_ item: AttentionItem) {
    do {
      try store.delete(id: item.id)
      refresh()
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func openHref(_ item: AttentionItem) {
    guard let href = item.href, let url = URL(string: href) else { return }
    #if canImport(AppKit)
    NSWorkspace.shared.open(url)
    #endif
  }
}
