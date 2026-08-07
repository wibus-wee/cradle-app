#if canImport(AppKit)
import AppKit
import UniformTypeIdentifiers
#endif
import AsyncAlgorithms
import Defaults
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
  /// When set, UI should scroll/highlight this id once.
  public var focusedItemId: String?
  public private(set) var lastDeleted: AttentionItem?
  public var isSelecting = false
  public var selectedIds: Set<String> = []

  @ObservationIgnored
  @Dependency(\.watchOutStore) private var store

  @ObservationIgnored
  private var observationTask: Task<Void, Never>?

  @ObservationIgnored
  private var searchTask: Task<Void, Never>?

  @ObservationIgnored
  private var searchContinuation: AsyncStream<String>.Continuation?

  @ObservationIgnored
  private var externalNotifyTask: Task<Void, Never>?

  @ObservationIgnored
  private var undoExpiryTask: Task<Void, Never>?

  @ObservationIgnored
  private var didRequestNotificationAuth = false

  public init() {
    startSearchDebounce()
    startObservation()
    startExternalParkNotifications()
  }

  public var displayedItems: [AttentionItem] {
    Array(items)
  }

  public var canUndoDelete: Bool {
    lastDeleted != nil
  }

  public func bootstrap() {
    refresh()
    WatchOutNotifier.configure()
    WatchOutUpdater.shared.startIfConfigured()
    Task { await requestNotificationsIfNeeded() }
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

  public func handleOpenURL(_ url: URL) {
    guard let link = WatchOutURLRouter.parse(url) else {
      statusMessage = "Unrecognized WatchOut URL."
      return
    }
    applyDeepLink(link)
  }

  public func applyDeepLink(_ link: WatchOutDeepLink) {
    switch link {
    case .park(let input):
      do {
        let item = try store.create(input)
        statusMessage = "Parked from URL."
        errorMessage = nil
        focusedItemId = item.id
        isFloatingPresented = true
        openCount = (try? store.openCount()) ?? openCount
        #if canImport(AppKit)
        NSApp.activate(ignoringOtherApps: true)
        #endif
      } catch {
        errorMessage = error.localizedDescription
      }

    case .item(let id):
      do {
        guard let item = try store.get(id: id) else {
          errorMessage = WatchOutStoreError.notFound(id).errorDescription
          return
        }
        if item.status == .done {
          showDone = true
          restartObservation()
        }
        focusedItemId = id
        isFloatingPresented = true
        statusMessage = nil
        #if canImport(AppKit)
        NSApp.activate(ignoringOtherApps: true)
        #endif
      } catch {
        errorMessage = error.localizedDescription
      }

    case .show:
      isFloatingPresented = true
      #if canImport(AppKit)
      NSApp.activate(ignoringOtherApps: true)
      #endif
    }
  }

  public func createFromDraft(source: String = "app") {
    let title = draftTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty else { return }
    do {
      let item = try store.create(
        AttentionItemCreate(
          title: title,
          source: source,
          audience: .human
        )
      )
      draftTitle = ""
      errorMessage = nil
      statusMessage = nil
      focusedItemId = item.id
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
      let item = try store.create(
        AttentionItemCreate(
          title: firstLine.isEmpty ? "Clipboard" : String(firstLine.prefix(120)),
          body: rest.isEmpty ? (firstLine.count > 120 ? text : nil) : rest,
          source: "clipboard",
          audience: .human
        )
      )
      statusMessage = "Parked clipboard."
      errorMessage = nil
      focusedItemId = item.id
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
      selectedIds.remove(item.id)
      openCount = (try? store.openCount()) ?? openCount
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func completeSelected() {
    let ids = Array(selectedIds)
    guard !ids.isEmpty else { return }
    do {
      let batch = try store.complete(ids: ids)
      selectedIds.removeAll()
      isSelecting = false
      statusMessage = "Completed \(batch.count)."
      openCount = (try? store.openCount()) ?? openCount
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  /// Completes every currently displayed open item (respects Done toggle + search).
  public func completeVisibleOpen() {
    let ids = items.filter { $0.status == .open }.map(\.id)
    guard !ids.isEmpty else {
      statusMessage = "Nothing open to complete."
      return
    }
    do {
      let batch = try store.complete(ids: ids)
      selectedIds.removeAll()
      isSelecting = false
      statusMessage = "Completed \(batch.count)."
      openCount = (try? store.openCount()) ?? openCount
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func toggleSelecting() {
    isSelecting.toggle()
    if !isSelecting {
      selectedIds.removeAll()
    }
  }

  public func toggleSelection(for item: AttentionItem) {
    if selectedIds.contains(item.id) {
      selectedIds.remove(item.id)
    } else {
      selectedIds.insert(item.id)
    }
  }

  public func selectAllVisible() {
    selectedIds = Set(items.map(\.id))
  }

  public func clearSelection() {
    selectedIds.removeAll()
  }

  public func exportVisibleToFile() {
    #if canImport(AppKit)
    let panel = NSSavePanel()
    panel.allowedContentTypes = [.json]
    panel.nameFieldStringValue = "watchout-export.json"
    panel.canCreateDirectories = true
    guard panel.runModal() == .OK, let url = panel.url else { return }
    do {
      let data = try store.exportJSON(currentQuery())
      try data.write(to: url, options: .atomic)
      let count = try JSONDecoder.watchOut.decode([AttentionItem].self, from: data).count
      statusMessage = "Exported \(count)."
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
    #else
    statusMessage = "Export requires macOS."
    #endif
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
      let removed = try store.deleteReturning(id: item.id)
      lastDeleted = removed
      scheduleUndoExpiry()
      statusMessage = "Deleted. Undo available."
      if editingItem?.id == item.id {
        cancelEditing()
      }
      openCount = (try? store.openCount()) ?? openCount
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func undoDelete() {
    guard let lastDeleted else { return }
    do {
      let restored = try store.restore(lastDeleted)
      self.lastDeleted = nil
      undoExpiryTask?.cancel()
      focusedItemId = restored.id
      statusMessage = "Restored."
      errorMessage = nil
      openCount = (try? store.openCount()) ?? openCount
      if restored.status == .done {
        showDone = true
        restartObservation()
      }
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  public func dismissUndo() {
    lastDeleted = nil
    undoExpiryTask?.cancel()
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

  public func clearFocusedItem() {
    focusedItemId = nil
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

  private func startExternalParkNotifications() {
    externalNotifyTask?.cancel()
    externalNotifyTask = Task { @MainActor in
      var lastOpenCount = (try? store.openCount()) ?? 0
      for await _ in store.observeExternalDataVersion() {
        guard !Task.isCancelled else { return }
        guard Defaults[.notifyOnExternalPark] else {
          lastOpenCount = (try? store.openCount()) ?? lastOpenCount
          continue
        }
        let open = (try? store.openCount()) ?? lastOpenCount
        defer { lastOpenCount = open }
        guard open > lastOpenCount else { continue }

        await requestNotificationsIfNeeded()
        let newest = try? store.list(AttentionListQuery(status: .open, limit: 1)).first
        await WatchOutNotifier.notifyExternalPark(
          title: newest?.title ?? "New item parked",
          itemId: newest?.id,
          openCount: open
        )
      }
    }
  }

  private func requestNotificationsIfNeeded() async {
    guard Defaults[.notifyOnExternalPark] else { return }
    guard !didRequestNotificationAuth else { return }
    didRequestNotificationAuth = true
    await WatchOutNotifier.requestAuthorizationIfNeeded()
  }

  private func scheduleUndoExpiry() {
    undoExpiryTask?.cancel()
    undoExpiryTask = Task { @MainActor in
      try? await Task.sleep(for: .seconds(10))
      guard !Task.isCancelled else { return }
      lastDeleted = nil
      if statusMessage == "Deleted. Undo available." {
        statusMessage = nil
      }
    }
  }
}

private extension String {
  var nilIfEmpty: String? {
    isEmpty ? nil : self
  }
}
