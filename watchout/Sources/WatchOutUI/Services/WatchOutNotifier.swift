#if canImport(UserNotifications)
import UserNotifications
#endif
import Foundation
import WatchOutCore

/// Local notifications for externally parked items (CLI / MCP / URL).
@MainActor
public enum WatchOutNotifier {
  public static let categoryIdentifier = "watchout.external-park"
  public static let openActionIdentifier = "watchout.open"
  public static let showActionIdentifier = "watchout.show"

  public static func configure() {
    #if canImport(UserNotifications)
    let open = UNNotificationAction(
      identifier: openActionIdentifier,
      title: "Open",
      options: [.foreground]
    )
    let show = UNNotificationAction(
      identifier: showActionIdentifier,
      title: "Show WatchOut",
      options: [.foreground]
    )
    let category = UNNotificationCategory(
      identifier: categoryIdentifier,
      actions: [open, show],
      intentIdentifiers: [],
      options: []
    )
    UNUserNotificationCenter.current().setNotificationCategories([category])
    #endif
  }

  public static func requestAuthorizationIfNeeded() async {
    #if canImport(UserNotifications)
    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    guard settings.authorizationStatus == .notDetermined else { return }
    _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
    #endif
  }

  public static func notifyExternalPark(title: String, itemId: String?, openCount: Int) async {
    #if canImport(UserNotifications)
    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    guard settings.authorizationStatus == .authorized
      || settings.authorizationStatus == .provisional
    else { return }

    let content = UNMutableNotificationContent()
    content.title = "WatchOut"
    content.body = openCount == 1
      ? title
      : "\(openCount) open — latest: \(title)"
    content.sound = .default
    content.categoryIdentifier = categoryIdentifier
    var info: [AnyHashable: Any] = ["openCount": openCount]
    if let itemId {
      info["itemId"] = itemId
    }
    content.userInfo = info
    if let itemId, let url = WatchOutURLRouter.itemURL(id: itemId) {
      // Helps hosts that surface notification URL metadata.
      content.userInfo["url"] = url.absoluteString
    }

    let request = UNNotificationRequest(
      identifier: "watchout.external.\(UUID().uuidString)",
      content: content,
      trigger: nil
    )
    try? await center.add(request)
    #endif
  }
}
