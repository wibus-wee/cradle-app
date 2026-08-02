#if canImport(AppKit)
import AppKit
#endif
import Defaults
import KeyboardShortcuts
import MenuBarExtraAccess
import SwiftUI

public enum WatchOutWindowID {
  public static let floating = "watchout.floating"
}

@MainActor
public struct WatchOutRootScene: Scene {
  @Bindable private var model: WatchOutAppModel
  @Default(.showMenuBarCount) private var showMenuBarCount
  @State private var menuBarExtraIsPresented = false

  public init(model: WatchOutAppModel) {
    self.model = model
  }

  public var body: some Scene {
    MenuBarExtra {
      MenuBarPanel(model: model)
    } label: {
      MenuBarLabel(openCount: model.openCount, showCount: showMenuBarCount)
    }
    .menuBarExtraStyle(.window)
    .menuBarExtraAccess(isPresented: $menuBarExtraIsPresented)

    Window("WatchOut", id: WatchOutWindowID.floating) {
      FloatingPanel(model: model)
        .frame(minWidth: 360, idealWidth: 420, minHeight: 420, idealHeight: 560)
    }
    .windowStyle(.hiddenTitleBar)
    .windowResizability(.contentSize)
    .defaultPosition(.topTrailing)

    Settings {
      TabView {
        WatchOutGeneralSettingsPane()
          .tabItem { Label("General", systemImage: "gearshape") }
        WatchOutShortcutsSettingsPane()
          .tabItem { Label("Shortcuts", systemImage: "keyboard") }
      }
      .frame(width: 520, height: 360)
    }
  }
}

struct MenuBarLabel: View {
  let openCount: Int
  let showCount: Bool

  var body: some View {
    if showCount, openCount > 0 {
      Label("WatchOut (\(openCount))", systemImage: "eye.trianglebadge.exclamationmark")
    } else {
      Label("WatchOut", systemImage: "eye")
    }
  }
}

struct MenuBarPanel: View {
  @Bindable var model: WatchOutAppModel
  @Environment(\.openWindow) private var openWindow
  @Default(.floatingVisibleOnLaunch) private var floatingVisibleOnLaunch
  @State private var didBootstrap = false
  @State private var hotKeys: WatchOutHotKeys?

  var body: some View {
    VStack(spacing: 0) {
      AttentionListPane(model: model, compact: true)
        .frame(width: 340, height: 420)
      Divider()
      HStack {
        Button("Floating Panel") { presentFloating() }
        Spacer()
        SettingsLink {
          Text("Settings…")
        }
        Button("Quit") {
          #if canImport(AppKit)
          NSApp.terminate(nil)
          #endif
        }
        .keyboardShortcut("q", modifiers: [.command])
      }
      .padding(10)
      .controlSize(.small)
    }
    .onAppear(perform: bootstrapIfNeeded)
  }

  private func bootstrapIfNeeded() {
    guard !didBootstrap else { return }
    didBootstrap = true
    model.refresh()
    let keys = WatchOutHotKeys { presentFloating() }
    keys.install()
    hotKeys = keys
    if floatingVisibleOnLaunch {
      presentFloating()
    }
  }

  private func presentFloating() {
    model.isFloatingPresented = true
    openWindow(id: WatchOutWindowID.floating)
  }
}

struct FloatingPanel: View {
  @Bindable var model: WatchOutAppModel
  @Default(.floatingAlwaysOnTop) private var floatingAlwaysOnTop

  var body: some View {
    AttentionListPane(model: model, compact: false)
      .background(.regularMaterial)
      .onAppear {
        model.refresh()
        applyFloatingLevel()
      }
      .onChange(of: floatingAlwaysOnTop) { _, _ in
        applyFloatingLevel()
      }
  }

  private func applyFloatingLevel() {
    #if canImport(AppKit)
    DispatchQueue.main.async {
      for window in NSApp.windows where window.title == "WatchOut" {
        window.level = floatingAlwaysOnTop ? .floating : .normal
        window.collectionBehavior.insert(.fullScreenAuxiliary)
        window.isMovableByWindowBackground = true
      }
    }
    #endif
  }
}

@MainActor
public final class WatchOutHotKeys {
  private let openFloating: () -> Void

  public init(openFloating: @escaping () -> Void) {
    self.openFloating = openFloating
  }

  public func install() {
    KeyboardShortcuts.onKeyUp(for: .toggleFloating) { [openFloating] in
      Task { @MainActor in openFloating() }
    }
    KeyboardShortcuts.onKeyUp(for: .quickCapture) { [openFloating] in
      Task { @MainActor in openFloating() }
    }
  }
}
