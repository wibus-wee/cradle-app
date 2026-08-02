import SwiftUI
import WatchOutUI

@main
struct WatchOutApp: App {
  @NSApplicationDelegateAdaptor(WatchOutAppDelegate.self) private var appDelegate

  var body: some Scene {
    WatchOutRootScene(model: appDelegate.model)
  }
}

@MainActor
final class WatchOutAppDelegate: NSObject {
  let model = WatchOutAppModel()
}

#if canImport(AppKit)
import AppKit

extension WatchOutAppDelegate: NSApplicationDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    model.bootstrap()
  }

  func application(_ application: NSApplication, open urls: [URL]) {
    for url in urls {
      model.handleOpenURL(url)
    }
  }
}
#endif
