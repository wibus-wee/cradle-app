import SwiftUI

enum WatchOutTheme {
  /// Attention amber — “look at this later”, not generic purple AI chrome.
  static let accent = Color(red: 0.92, green: 0.55, blue: 0.18)
  static let accentSoft = Color(red: 0.92, green: 0.55, blue: 0.18).opacity(0.14)
  static let ink = Color(red: 0.11, green: 0.12, blue: 0.14)
  static let inkSecondary = Color.primary.opacity(0.55)
  static let hairline = Color.primary.opacity(0.08)
  static let rowFill = Color.primary.opacity(0.035)
  static let rowFillHover = Color.primary.opacity(0.06)

  static let panelCorner: CGFloat = 16
  static let rowCorner: CGFloat = 12
  static let controlCorner: CGFloat = 10
}

struct WatchOutPressableButtonStyle: ButtonStyle {
  var scale: CGFloat = 0.97

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? scale : 1)
      .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
  }
}

struct WatchOutBadge: View {
  let count: Int

  var body: some View {
    Text("\(count)")
      .font(.caption.weight(.semibold).monospacedDigit())
      .foregroundStyle(count > 0 ? WatchOutTheme.ink : .secondary)
      .padding(.horizontal, 7)
      .padding(.vertical, 3)
      .background(
        Capsule(style: .continuous)
          .fill(count > 0 ? WatchOutTheme.accentSoft : Color.primary.opacity(0.06))
      )
      .overlay(
        Capsule(style: .continuous)
          .strokeBorder(WatchOutTheme.hairline, lineWidth: 1)
      )
      .accessibilityLabel("\(count) open items")
  }
}

struct WatchOutMark: View {
  var size: CGFloat = 22

  var body: some View {
    ZStack {
      RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
        .fill(WatchOutTheme.accent.gradient)
        .frame(width: size, height: size)
        .shadow(color: WatchOutTheme.accent.opacity(0.35), radius: 6, y: 2)
      Image(systemName: "eye.fill")
        .font(.system(size: size * 0.42, weight: .bold))
        .foregroundStyle(.white)
        .offset(y: 0.5)
    }
    .accessibilityHidden(true)
  }
}
