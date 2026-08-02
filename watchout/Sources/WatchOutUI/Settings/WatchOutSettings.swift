import Defaults
import KeyboardShortcuts
import LaunchAtLogin
import SwiftUI
import WatchOutCore

public struct WatchOutGeneralSettingsPane: View {
  @Default(.floatingAlwaysOnTop) private var floatingAlwaysOnTop
  @Default(.showMenuBarCount) private var showMenuBarCount
  @Default(.floatingVisibleOnLaunch) private var floatingVisibleOnLaunch

  public init() {}

  public var body: some View {
    Form {
      Section("Launch") {
        LaunchAtLogin.Toggle("Open at login")
        Toggle("Show floating panel on launch", isOn: $floatingVisibleOnLaunch)
      }
      Section("Windows") {
        Toggle("Keep floating panel on top", isOn: $floatingAlwaysOnTop)
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
  }

  private var dbPath: String {
    let url = (try? WatchOutStore.applicationSupportDirectory())?
      .appendingPathComponent("watchout.sqlite")
    return url?.path ?? "(unavailable)"
  }
}

public struct WatchOutShortcutsSettingsPane: View {
  public init() {}

  public var body: some View {
    Form {
      Section("Global shortcuts") {
        KeyboardShortcuts.Recorder("Toggle floating panel", name: .toggleFloating)
        KeyboardShortcuts.Recorder("Focus quick capture", name: .quickCapture)
      }
    }
    .formStyle(.grouped)
  }
}
