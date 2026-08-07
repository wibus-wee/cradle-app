import Defaults
import Foundation
#if canImport(Sparkle)
import Sparkle
#endif

/// Sparkle-backed updater. Idle until a feed URL is configured in Settings.
@MainActor
public final class WatchOutUpdater: NSObject {
  public static let shared = WatchOutUpdater()

  #if canImport(Sparkle)
  private var controller: SPUStandardUpdaterController?
  #endif

  private override init() {
    super.init()
  }

  public var isConfigured: Bool {
    let raw = Defaults[.sparkleFeedURL].trimmingCharacters(in: .whitespacesAndNewlines)
    return URL(string: raw)?.scheme?.hasPrefix("http") == true
  }

  public func startIfConfigured() {
    #if canImport(Sparkle)
    guard isConfigured else { return }
    guard controller == nil else { return }
    controller = SPUStandardUpdaterController(
      startingUpdater: true,
      updaterDelegate: self,
      userDriverDelegate: nil
    )
    #endif
  }

  public func checkForUpdates() {
    #if canImport(Sparkle)
    startIfConfigured()
    controller?.checkForUpdates(nil)
    #endif
  }

  public func applyFeedURLFromDefaults() {
    #if canImport(Sparkle)
    if isConfigured {
      startIfConfigured()
    }
    #endif
  }
}

#if canImport(Sparkle)
extension WatchOutUpdater: SPUUpdaterDelegate {
  nonisolated public func feedURLString(for updater: SPUUpdater) -> String? {
    let raw = Defaults[.sparkleFeedURL].trimmingCharacters(in: .whitespacesAndNewlines)
    guard URL(string: raw)?.scheme?.hasPrefix("http") == true else { return nil }
    return raw
  }
}
#endif
