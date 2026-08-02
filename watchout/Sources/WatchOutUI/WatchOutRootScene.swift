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
        .frame(minWidth: 400, idealWidth: 460, minHeight: 560, idealHeight: 680)
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
    HStack(spacing: 5) {
      WatchOutSignalDot(active: openCount > 0, size: 6)
      if showCount, openCount > 0 {
        Text("\(openCount)")
          .font(.system(size: 11, weight: .bold, design: .monospaced))
          .monospacedDigit()
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
      .frame(width: 380, height: 500)
      .background {
        ZStack {
          WatchOutTheme.mist
          Rectangle().fill(.ultraThinMaterial.opacity(0.65))
          WatchOutGridBackdrop()
            .opacity(0.35)
        }
      }
      .clipShape(RoundedRectangle(cornerRadius: WatchOutTheme.panelRadius, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: WatchOutTheme.panelRadius, style: .continuous)
          .strokeBorder(WatchOutTheme.hairline, lineWidth: 1)
      )
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
    VStack(spacing: 0) {
      floatingChrome
      AttentionListPane(model: model, compact: false)
    }
    .background {
      ZStack {
        WatchOutTheme.mist
        LinearGradient(
          colors: [
            WatchOutTheme.phosphor.opacity(0.10),
            .clear,
            Color.black.opacity(0.03),
          ],
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
        WatchOutGridBackdrop().opacity(0.4)
      }
    }
    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .strokeBorder(WatchOutTheme.ink.opacity(0.12), lineWidth: 1)
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
    HStack {
      Text("FLOAT MODE")
        .font(.system(size: 9, weight: .heavy, design: .monospaced))
        .tracking(1.6)
        .foregroundStyle(WatchOutTheme.slate)
      Rectangle()
        .fill(WatchOutTheme.hairline)
        .frame(height: 1)
      Button {
        floatingAlwaysOnTop.toggle()
      } label: {
        Text(floatingAlwaysOnTop ? "PINNED" : "PIN")
          .font(.system(size: 9, weight: .heavy, design: .monospaced))
          .tracking(1)
          .foregroundStyle(floatingAlwaysOnTop ? WatchOutTheme.ink : WatchOutTheme.slate)
          .padding(.horizontal, 8)
          .padding(.vertical, 5)
          .background(
            RoundedRectangle(cornerRadius: 2, style: .continuous)
              .fill(floatingAlwaysOnTop ? WatchOutTheme.phosphor : Color.clear)
              .overlay(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                  .strokeBorder(WatchOutTheme.hairline, lineWidth: 1)
              )
          )
      }
      .buttonStyle(WatchOutPressStyle())
    }
    .padding(.horizontal, 16)
    .padding(.top, 12)
    .padding(.bottom, 2)
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

struct WatchOutGridBackdrop: View {
  var body: some View {
    Canvas { context, size in
      let step: CGFloat = 16
      var path = Path()
      stride(from: 0, through: size.width, by: step).forEach { x in
        path.move(to: CGPoint(x: x, y: 0))
        path.addLine(to: CGPoint(x: x, y: size.height))
      }
      stride(from: 0, through: size.height, by: step).forEach { y in
        path.move(to: CGPoint(x: 0, y: y))
        path.addLine(to: CGPoint(x: size.width, y: y))
      }
      context.stroke(path, with: .color(.black.opacity(0.035)), lineWidth: 1)
    }
    .allowsHitTesting(false)
  }
}

#if canImport(AppKit)
private struct WindowDragHandle: NSViewRepresentable {
  func makeNSView(context: Context) -> NSView { DragRegionView() }
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
