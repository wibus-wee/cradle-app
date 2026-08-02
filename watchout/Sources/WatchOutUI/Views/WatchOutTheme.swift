import SwiftUI

enum WatchOutTheme {
  /// Mint phosphor — used sparingly (active signal / primary fill).
  static let phosphor = Color(red: 0.22, green: 0.86, blue: 0.62)
  static let phosphorDim = Color(red: 0.22, green: 0.86, blue: 0.62).opacity(0.14)
  static let ink = Color.primary
  static let secondary = Color.secondary
}

struct WatchOutPressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .opacity(configuration.isPressed ? 0.7 : 1)
  }
}
