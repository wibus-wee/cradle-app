import Dependencies
import Foundation

private enum WatchOutStoreKey: DependencyKey {
  static var liveValue: WatchOutStore {
    do {
      return try WatchOutStore.makeDefault()
    } catch {
      fatalError("WatchOutStore failed to open: \(error)")
    }
  }

  static var testValue: WatchOutStore {
    try! WatchOutStore.makeInMemory()
  }
}

extension DependencyValues {
  public var watchOutStore: WatchOutStore {
    get { self[WatchOutStoreKey.self] }
    set { self[WatchOutStoreKey.self] = newValue }
  }
}
