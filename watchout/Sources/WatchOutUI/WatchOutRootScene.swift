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
        .frame(minWidth: 300, idealWidth: 340, minHeight: 400, idealHeight: 480)
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
      .frame(width: 420, height: 320)
    }
  }
}

struct MenuBarLabel: View {
  let openCount: Int
  let showCount: Bool

  var body: some View {
    Label {
      if showCount, openCount > 0 {
        Text("\(openCount)")
          .font(.caption2.monospacedDigit().weight(.semibold))
      } else {
        Text("WatchOut")
      }
    } icon: {
      Image(systemName: "eyeglasses")
    }
    .labelStyle(.titleAndIcon)
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
      .frame(width: 300, height: 400)
      .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
      .onAppear(perform: bootstrapIfNeeded)
  }

  private func bootstrapIfNeeded() {
    guard !didBootstrap else { return }
    didBootstrap = true
    model.refresh()
    let keys = WatchOutHotKeys(
      openFloating: { presentFloating() },
      parkClipboard: { model.parkClipboard() }
    )
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
      .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
      .padding(6)
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
        window.backgroundColor = .clear
      }
    }
    #endif
  }
}

@MainActor
public final class WatchOutHotKeys {
  private let openFloating: () -> Void
  private let parkClipboard: () -> Void

  public init(openFloating: @escaping () -> Void, parkClipboard: @escaping () -> Void = {}) {
    self.openFloating = openFloating
    self.parkClipboard = parkClipboard
  }

  public func install() {
    KeyboardShortcuts.onKeyUp(for: .toggleFloating) { [openFloating] in
      Task { @MainActor in openFloating() }
    }
    KeyboardShortcuts.onKeyUp(for: .quickCapture) { [openFloating] in
      Task { @MainActor in openFloating() }
    }
    KeyboardShortcuts.onKeyUp(for: .parkClipboard) { [parkClipboard] in
      Task { @MainActor in parkClipboard() }
    }
  }
}
