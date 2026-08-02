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
        .frame(minWidth: 380, idealWidth: 440, minHeight: 520, idealHeight: 640)
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
    HStack(spacing: 4) {
      Image(systemName: openCount > 0 ? "eye.trianglebadge.exclamationmark.fill" : "eye.fill")
      if showCount, openCount > 0 {
        Text("\(openCount)")
          .font(.caption2.weight(.bold).monospacedDigit())
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
    VStack(spacing: 0) {
      AttentionListPane(model: model, compact: true)
        .frame(width: 360, height: 460)

      footer
    }
    .background(.ultraThinMaterial)
    .onAppear(perform: bootstrapIfNeeded)
  }

  private var footer: some View {
    HStack(spacing: 8) {
      Button {
        presentFloating()
      } label: {
        Label("Open Floating", systemImage: "macwindow.on.rectangle")
          .font(.caption.weight(.semibold))
          .padding(.horizontal, 10)
          .padding(.vertical, 7)
          .background(
            Capsule(style: .continuous)
              .fill(WatchOutTheme.accentSoft)
          )
          .overlay(
            Capsule(style: .continuous)
              .strokeBorder(WatchOutTheme.accent.opacity(0.25), lineWidth: 1)
          )
          .foregroundStyle(WatchOutTheme.ink)
      }
      .buttonStyle(WatchOutPressableButtonStyle())

      Spacer()

      SettingsLink {
        Image(systemName: "gearshape")
          .font(.system(size: 12, weight: .semibold))
          .foregroundStyle(.secondary)
          .frame(width: 28, height: 28)
          .background(Circle().fill(Color.primary.opacity(0.05)))
      }
      .help("Settings")

      Button {
        #if canImport(AppKit)
        NSApp.terminate(nil)
        #endif
      } label: {
        Image(systemName: "power")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(.secondary)
          .frame(width: 28, height: 28)
          .background(Circle().fill(Color.primary.opacity(0.05)))
      }
      .buttonStyle(WatchOutPressableButtonStyle())
      .keyboardShortcut("q", modifiers: [.command])
      .help("Quit WatchOut")
    }
    .padding(.horizontal, 14)
    .padding(.vertical, 10)
    .overlay(alignment: .top) {
      Rectangle()
        .fill(WatchOutTheme.hairline)
        .frame(height: 1)
    }
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
    VStack(spacing: 0) {
      floatingChrome
      AttentionListPane(model: model, compact: false)
    }
    .background {
      ZStack {
        Rectangle().fill(.ultraThickMaterial)
        LinearGradient(
          colors: [
            WatchOutTheme.accent.opacity(0.10),
            .clear,
            Color.black.opacity(0.03),
          ],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 18, style: .continuous)
        .strokeBorder(WatchOutTheme.hairline, lineWidth: 1)
    )
    .padding(1)
    .onAppear {
      model.refresh()
      applyFloatingLevel()
    }
    .onChange(of: floatingAlwaysOnTop) { _, _ in
      applyFloatingLevel()
    }
  }

  private var floatingChrome: some View {
    HStack(spacing: 10) {
      Text("FLOATING")
        .font(.caption2.weight(.bold))
        .tracking(1.2)
        .foregroundStyle(WatchOutTheme.inkSecondary)
      Spacer()
      Button {
        floatingAlwaysOnTop.toggle()
      } label: {
        Image(systemName: floatingAlwaysOnTop ? "pin.fill" : "pin")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(floatingAlwaysOnTop ? WatchOutTheme.accent : .secondary)
          .frame(width: 26, height: 26)
          .background(Circle().fill(Color.primary.opacity(0.05)))
      }
      .buttonStyle(WatchOutPressableButtonStyle())
      .help(floatingAlwaysOnTop ? "Unpin from top" : "Keep on top")
    }
    .padding(.horizontal, 16)
    .padding(.top, 12)
    .padding(.bottom, 4)
    #if canImport(AppKit)
    .background(WindowDragHandle())
    #endif
  }

  private func applyFloatingLevel() {
    #if canImport(AppKit)
    DispatchQueue.main.async {
      for window in NSApp.windows where window.title == "WatchOut" {
        window.level = floatingAlwaysOnTop ? .floating : .normal
        window.collectionBehavior.insert(.fullScreenAuxiliary)
        window.isMovableByWindowBackground = true
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .clear
      }
    }
    #endif
  }
}

#if canImport(AppKit)
private struct WindowDragHandle: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView {
    let view = DragRegionView()
    return view
  }

  func updateNSView(_ nsView: NSView, context: Context) {}

  final class DragRegionView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }
  }
}
#endif

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
