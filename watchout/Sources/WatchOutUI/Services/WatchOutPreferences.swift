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
  static let toggleFloating = Self("toggleFloating", default: .init(.w, modifiers: [.option, .command]))
  static let quickCapture = Self("quickCapture", default: .init(.n, modifiers: [.option, .command]))
  static let parkClipboard = Self("parkClipboard", default: .init(.v, modifiers: [.option, .command, .shift]))
  static let toggleMenuBarPanel = Self("toggleMenuBarPanel")
}
