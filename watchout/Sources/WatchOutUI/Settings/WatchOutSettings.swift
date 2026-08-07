#if canImport(AppKit)
import AppKit
#endif
import Defaults
import KeyboardShortcuts
import LaunchAtLogin
import SwiftUI
import WatchOutCore

public struct WatchOutGeneralSettingsPane: View {
  @Default(.floatingAlwaysOnTop) private var floatingAlwaysOnTop
  @Default(.showMenuBarCount) private var showMenuBarCount
  @Default(.floatingVisibleOnLaunch) private var floatingVisibleOnLaunch
  @Default(.notifyOnExternalPark) private var notifyOnExternalPark
  @Default(.sparkleFeedURL) private var sparkleFeedURL

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
      Section("Notifications") {
        Toggle("Notify when CLI/MCP parks an item", isOn: $notifyOnExternalPark)
      }
      Section("Updates") {
        TextField("Sparkle appcast URL", text: $sparkleFeedURL)
          .textFieldStyle(.roundedBorder)
          .onChange(of: sparkleFeedURL) { _, _ in
            WatchOutUpdater.shared.applyFeedURLFromDefaults()
          }
        Button("Check for Updates…") {
          WatchOutUpdater.shared.checkForUpdates()
        }
        .disabled(!WatchOutUpdater.shared.isConfigured)
        Text("Leave empty until you publish a signed Sparkle feed.")
          .font(.caption)
          .foregroundStyle(.secondary)
      }
      Section("Data") {
        LabeledContent("Database") {
          Text(dbPath)
            .font(.caption.monospaced())
            .textSelection(.enabled)
        }
        Button("Reveal in Finder") {
          revealDatabase()
        }
      }
    }
    .formStyle(.grouped)
  }

  private var dbPath: String {
    (try? WatchOutStore.databaseURL())?.path ?? "(unavailable)"
  }

  private func revealDatabase() {
    #if canImport(AppKit)
    guard let url = try? WatchOutStore.databaseURL() else { return }
    NSWorkspace.shared.activateFileViewerSelecting([url])
    #endif
  }
}

public struct WatchOutShortcutsSettingsPane: View {
  public init() {}

  public var body: some View {
    Form {
      Section("Global shortcuts") {
        KeyboardShortcuts.Recorder("Toggle floating panel", name: .toggleFloating)
        KeyboardShortcuts.Recorder("Focus quick capture", name: .quickCapture)
        KeyboardShortcuts.Recorder("Park clipboard", name: .parkClipboard)
      }
    }
    .formStyle(.grouped)
  }
}
