import Defaults
import Foundation
import KeyboardShortcuts

extension Defaults.Keys {
  static let floatingAlwaysOnTop = Key<Bool>("floatingAlwaysOnTop", default: true)
  static let showMenuBarCount = Key<Bool>("showMenuBarCount", default: true)
  static let floatingVisibleOnLaunch = Key<Bool>("floatingVisibleOnLaunch", default: false)
  static let defaultAudience = Key<String>("defaultAudience", default: "human")
}

extension KeyboardShortcuts.Name {
  static let toggleFloating = Self("toggleFloating")
  static let quickCapture = Self("quickCapture")
  static let toggleMenuBarPanel = Self("toggleMenuBarPanel")
}
