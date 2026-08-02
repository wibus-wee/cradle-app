#if canImport(UserNotifications)
import UserNotifications
#endif
import Foundation

/// Local notifications for externally parked items (CLI / MCP / URL).
@MainActor
public enum WatchOutNotifier {
  public static let categoryIdentifier = "watchout.external-park"

  public static func requestAuthorizationIfNeeded() async {
    #if canImport(UserNotifications)
    let center = UNUserNotificationCenter.current()
    let settings = await center.notificationSettings()
    guard settings.authorizationStatus == .notDetermined else { return }
    _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
    #endif
  }

  public static func notifyExternalPark(title: String, openCount: Int) async {
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
    content.userInfo = ["openCount": openCount]

    let request = UNNotificationRequest(
      identifier: "watchout.external.\(UUID().uuidString)",
      content: content,
      trigger: nil
    )
    try? await center.add(request)
    #endif
  }
}
