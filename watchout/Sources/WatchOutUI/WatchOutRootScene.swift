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
        .frame(minWidth: 320, idealWidth: 360, minHeight: 420, idealHeight: 520)
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
      .frame(width: 420, height: 280)
    }
  }
}

struct MenuBarLabel: View {
  let openCount: Int
  let showCount: Bool

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: openCount > 0 ? "circle.fill" : "circle")
        .font(.system(size: 7, weight: .bold))
        .foregroundStyle(openCount > 0 ? WatchOutTheme.phosphor : .secondary)
      if showCount, openCount > 0 {
        Text("\(openCount)")
          .font(.caption2.monospacedDigit().weight(.semibold))
      }
    }
    .help(openCount > 0 ? "WatchOut — \(openCount) open" : "WatchOut")
  }
}

struct MenuBarPanel: View {
  @Bindable var model: WatchOutAppModel
  @Environment(\.openWindow) private var openWindow
  @Default(.floatingVisibleOnLaunch) private var floatingVisibleOnLaunch
  @State private var didBootstrap = false
  @State private var hotKeys: WatchOutHotKeys?

  var body: some View {
    AttentionListPane(model: model, compact: true)
      .frame(width: 320, height: 420)
      .background(.background)
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
      .background(.background)
      .onAppear {
        model.refresh()
        applyFloatingLevel()
      }
      .onChange(of: floatingAlwaysOnTop) { _, _ in
        applyFloatingLevel()
      }
      .toolbar {
        ToolbarItem(placement: .automatic) {
          Toggle(isOn: $floatingAlwaysOnTop) {
            Image(systemName: floatingAlwaysOnTop ? "pin.fill" : "pin")
          }
          .toggleStyle(.button)
          .help(floatingAlwaysOnTop ? "Unpin" : "Keep on top")
        }
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
