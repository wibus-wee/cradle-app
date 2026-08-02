#if canImport(AppKit)
import AppKit
#endif
import AsyncAlgorithms
import Dependencies
import Foundation
import IdentifiedCollections
import Observation
import WatchOutCore

@MainActor
@Observable
public final class WatchOutAppModel {
  public private(set) var items: IdentifiedArrayOf<AttentionItem> = []
  public private(set) var openCount: Int = 0
  public var draftTitle: String = ""
  public var searchText: String = ""
  public var errorMessage: String?
  public var statusMessage: String?
  public var isFloatingPresented: Bool = false
  public var showDone: Bool = false
  public var editingItem: AttentionItem?
  public var editTitle: String = ""
  public var editBody: String = ""

  @ObservationIgnored
  @Dependency(\.watchOutStore) private var store

  @ObservationIgnored
  private var observationTask: Task<Void, Never>?

  @ObservationIgnored
  private var searchTask: Task<Void, Never>?

  @ObservationIgnored
  private var searchContinuation: AsyncStream<String>.Continuation?

  public init() {
    startSearchDebounce()
    startObservation()
  }

  public var displayedItems: [AttentionItem] {
    Array(items)
  }

  public func refresh() {
    restartObservation()
  }

  public func setShowDone(_ value: Bool) {
    guard showDone != value else { return }
    showDone = value
    restartObservation()
  }

  public func setSearchText(_ value: String) {
    searchText = value
    searchContinuation?.yield(value)
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
      errorMessage = nil
      statusMessage = nil
      openCount = (try? store.openCount()) ?? openCount
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func parkClipboard() {
    #if canImport(AppKit)
    let text = NSPasteboard.general.string(forType: .string)?
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard let text, !text.isEmpty else {
      statusMessage = "Clipboard is empty."
      return
    }

    let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
    let firstLine = String(lines.first ?? Substring(text))
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let rest = lines.dropFirst()
      .joined(separator: "\n")
      .trimmingCharacters(in: .whitespacesAndNewlines)

    do {
      _ = try store.create(
        AttentionItemCreate(
          title: firstLine.isEmpty ? "Clipboard" : String(firstLine.prefix(120)),
          body: rest.isEmpty ? (firstLine.count > 120 ? text : nil) : rest,
          source: "clipboard",
          audience: .human
        )
      )
      statusMessage = "Parked clipboard."
      errorMessage = nil
      openCount = (try? store.openCount()) ?? openCount
    } catch {
      errorMessage = error.localizedDescription
    }
    #else
    statusMessage = "Clipboard parking requires macOS."
    #endif
  }

  public func beginEditing(_ item: AttentionItem) {
    editingItem = item
    editTitle = item.title
    editBody = item.body ?? ""
  }

  public func cancelEditing() {
    editingItem = nil
    editTitle = ""
    editBody = ""
  }

  public func saveEditing() {
    guard let editingItem else { return }
    let title = editTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty else {
      errorMessage = "Title is required."
      return
    }

    do {
      _ = try store.update(
        id: editingItem.id,
        AttentionItemUpdate(
          title: title,
          body: .some(editBody.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty)
        )
      )
      cancelEditing()
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func complete(_ item: AttentionItem) {
    do {
      _ = try store.complete(id: item.id)
      openCount = (try? store.openCount()) ?? openCount
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func reopen(_ item: AttentionItem) {
    do {
      _ = try store.reopen(id: item.id)
      openCount = (try? store.openCount()) ?? openCount
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func delete(_ item: AttentionItem) {
    do {
      try store.delete(id: item.id)
      if editingItem?.id == item.id {
        cancelEditing()
      }
      openCount = (try? store.openCount()) ?? openCount
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func copyItem(_ item: AttentionItem) {
    #if canImport(AppKit)
    var text = item.title
    if let body = item.body, !body.isEmpty {
      text += "\n\n" + body
    }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setString(text, forType: .string)
    statusMessage = "Copied."
    #endif
  }

  public func openHref(_ item: AttentionItem) {
    guard let href = item.href, let url = URL(string: href) else { return }
    #if canImport(AppKit)
    NSWorkspace.shared.open(url)
    #endif
  }

  public func revealDatabaseInFinder() {
    #if canImport(AppKit)
    guard let url = try? WatchOutStore.databaseURL() else { return }
    NSWorkspace.shared.activateFileViewerSelecting([url])
    #endif
  }

  private func currentQuery() -> AttentionListQuery {
    AttentionListQuery(
      status: showDone ? nil : .open,
      search: searchText.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
      limit: 200
    )
  }

  private func startSearchDebounce() {
    searchTask?.cancel()
    let (stream, continuation) = AsyncStream.makeStream(of: String.self)
    searchContinuation = continuation
    searchTask = Task { @MainActor in
      for await _ in stream.debounce(for: .milliseconds(180), clock: ContinuousClock()) {
        guard !Task.isCancelled else { return }
        restartObservation()
      }
    }
  }

  private func startObservation() {
    observationTask?.cancel()
    let query = currentQuery()
    observationTask = Task { @MainActor in
      for await snapshot in store.observe(query) {
        guard !Task.isCancelled else { return }
        items = snapshot.items
        openCount = snapshot.openCount
      }
    }
  }

  private func restartObservation() {
    startObservation()
  }
}

private extension String {
  var nilIfEmpty: String? {
    isEmpty ? nil : self
  }
}
