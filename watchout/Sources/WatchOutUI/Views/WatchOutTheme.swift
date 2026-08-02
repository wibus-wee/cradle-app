import SwiftUI

/// WatchOut visual language: cool stone desk + phosphor signal.
/// Intentionally not cream/terracotta, not purple-AI chrome.
enum WatchOutTheme {
  static let phosphor = Color(red: 0.22, green: 0.86, blue: 0.62)
  static let phosphorDim = Color(red: 0.22, green: 0.86, blue: 0.62).opacity(0.16)
  static let ink = Color(red: 0.07, green: 0.09, blue: 0.12)
  static let mist = Color(red: 0.90, green: 0.92, blue: 0.94)
  static let slate = Color(red: 0.45, green: 0.50, blue: 0.56)
  static let hairline = Color.black.opacity(0.10)
  static let panelFill = Color.white.opacity(0.78)
  static let ticketFill = Color.white.opacity(0.92)
  static let danger = Color(red: 0.86, green: 0.28, blue: 0.28)

  static let panelRadius: CGFloat = 10
  static let ticketRadius: CGFloat = 4
}

struct WatchOutPressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .opacity(configuration.isPressed ? 0.88 : 1)
      .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
  }
}

struct WatchOutSignalDot: View {
  var active: Bool = true
  var size: CGFloat = 8

  var body: some View {
    ZStack {
      if active {
        Circle()
          .fill(WatchOutTheme.phosphor.opacity(0.28))
          .frame(width: size * 2.2, height: size * 2.2)
      }
      Circle()
        .fill(active ? WatchOutTheme.phosphor : WatchOutTheme.slate.opacity(0.35))
        .frame(width: size, height: size)
    }
  }
}

struct WatchOutStamp: View {
  var compact: Bool = false

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: compact ? 8 : 10) {
      WatchOutSignalDot(size: compact ? 7 : 9)
      Text("WATCHOUT")
        .font(.system(size: compact ? 13 : 15, weight: .heavy, design: .default))
        .tracking(compact ? 2.4 : 3.2)
        .foregroundStyle(WatchOutTheme.ink)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("WatchOut")
  }
}

struct WatchOutCountTape: View {
  let count: Int

  var body: some View {
    HStack(spacing: 6) {
      Text("OPEN")
        .font(.system(size: 9, weight: .bold, design: .monospaced))
        .tracking(1.1)
        .foregroundStyle(WatchOutTheme.slate)
      Text("\(count)")
        .font(.system(size: 13, weight: .bold, design: .monospaced))
        .monospacedDigit()
        .foregroundStyle(count > 0 ? WatchOutTheme.ink : WatchOutTheme.slate)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 5)
    .background(
      RoundedRectangle(cornerRadius: 3, style: .continuous)
        .strokeBorder(WatchOutTheme.hairline, lineWidth: 1)
        .background(
          RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(count > 0 ? WatchOutTheme.phosphorDim : Color.clear)
        )
    )
  }
}
