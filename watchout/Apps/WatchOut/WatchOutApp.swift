import SwiftUI
import WatchOutUI
#if canImport(UserNotifications)
import UserNotifications
#endif

@main
struct WatchOutApp: App {
  @NSApplicationDelegateAdaptor(WatchOutAppDelegate.self) private var appDelegate

  var body: some Scene {
    WatchOutRootScene(model: appDelegate.model)
      .commands {
        CommandGroup(replacing: .undoRedo) {
          Button("Undo Delete") {
            appDelegate.model.undoDelete()
          }
          .keyboardShortcut("z", modifiers: .command)
          .disabled(!appDelegate.model.canUndoDelete)
        }
        CommandGroup(after: .appInfo) {
          Button("Check for Updates…") {
            WatchOutUpdater.shared.checkForUpdates()
          }
          .disabled(!WatchOutUpdater.shared.isConfigured)
        }
      }
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
    #if canImport(UserNotifications)
    UNUserNotificationCenter.current().delegate = self
    #endif
    model.bootstrap()
  }

  func application(_ application: NSApplication, open urls: [URL]) {
    for url in urls {
      model.handleOpenURL(url)
    }
  }
}
#endif

#if canImport(UserNotifications)
extension WatchOutAppDelegate: UNUserNotificationCenterDelegate {
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .sound]
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse
  ) async {
    let info = response.notification.request.content.userInfo
    let itemId = info["itemId"] as? String
    let action = response.actionIdentifier
    await MainActor.run {
      switch action {
      case WatchOutNotifier.openActionIdentifier, UNNotificationDefaultActionIdentifier:
        if let itemId {
          model.applyDeepLink(.item(id: itemId))
        } else {
          model.applyDeepLink(.show)
        }
      case WatchOutNotifier.showActionIdentifier:
        model.applyDeepLink(.show)
      default:
        break
      }
    }
  }
}
#endif
