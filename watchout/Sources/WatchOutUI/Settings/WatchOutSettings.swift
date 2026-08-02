#if canImport(AppKit)
import AppKit
#endif
import Defaults
import KeyboardShortcuts
import LaunchAtLogin
import SwiftUI
import WatchOutCore

struct GeneralSettingsView: View {
  @Default(.floatingAlwaysOnTop) private var floatingAlwaysOnTop
  @Default(.showMenuBarCount) private var showMenuBarCount
  @Default(.floatingVisibleOnLaunch) private var floatingVisibleOnLaunch

  var body: some View {
    Form {
      Section("Launch") {
        LaunchAtLogin.Toggle("Open at login")
        Toggle("Show floating panel on launch", isOn: $floatingVisibleOnLaunch)
      }
      Section("Windows") {
        Toggle("Floating panel always on top", isOn: $floatingAlwaysOnTop)
        Toggle("Show open count in menu bar", isOn: $showMenuBarCount)
      }
      Section("Data") {
        LabeledContent("Database") {
          Text(dbPath)
            .font(.caption.monospaced())
            .textSelection(.enabled)
        }
      }
    }
    .formStyle(.grouped)
    .padding()
    .frame(width: 480, height: 320)
  }

  private var dbPath: String {
    let url = (try? WatchOutStore.applicationSupportDirectory())?
      .appendingPathComponent("watchout.sqlite")
    return url?.path ?? "(unavailable)"
  }
}

struct ShortcutsSettingsView: View {
  var body: some View {
    Form {
      Section("Global shortcuts") {
        KeyboardShortcuts.Recorder("Toggle floating panel", name: .toggleFloating)
        KeyboardShortcuts.Recorder("Focus quick capture", name: .quickCapture)
      }
    }
    .formStyle(.grouped)
    .padding()
    .frame(width: 480, height: 220)
  }
}

public struct WatchOutGeneralSettingsPane: View {
  public init() {}
  public var body: some View { GeneralSettingsView() }
}

public struct WatchOutShortcutsSettingsPane: View {
  public init() {}
  public var body: some View { ShortcutsSettingsView() }
}
