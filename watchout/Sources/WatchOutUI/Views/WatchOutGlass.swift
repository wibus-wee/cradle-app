import SwiftUI

/// Liquid Glass is reserved for WatchOut's floating action/navigation layer.
/// The attention list itself stays in the content layer so text remains calm and legible.
struct WatchOutGlassCapsule<Content: View>: View {
  private let content: Content

  init(@ViewBuilder content: () -> Content) {
    self.content = content()
  }

  var body: some View {
#if compiler(>=6.2)
    if #available(macOS 26.0, *) {
      content.glassEffect(.regular, in: Capsule(style: .continuous))
    } else {
      content.background(.regularMaterial, in: Capsule(style: .continuous))
    }
#else
    content.background(.regularMaterial, in: Capsule(style: .continuous))
#endif
  }
}

struct WatchOutGlassRounded<Content: View>: View {
  private let cornerRadius: CGFloat
  private let content: Content

  init(cornerRadius: CGFloat, @ViewBuilder content: () -> Content) {
    self.cornerRadius = cornerRadius
    self.content = content()
  }

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
#if compiler(>=6.2)
    if #available(macOS 26.0, *) {
      content.glassEffect(.regular, in: shape)
    } else {
      content.background(.regularMaterial, in: shape)
    }
#else
    content.background(.regularMaterial, in: shape)
#endif
  }
}

@ViewBuilder
func watchOutGlassGroup<Content: View>(
  @ViewBuilder content: () -> Content
) -> some View {
#if compiler(>=6.2)
  if #available(macOS 26.0, *) {
    GlassEffectContainer(spacing: 10) {
      content()
    }
  } else {
    content()
  }
#else
  content()
#endif
}

extension View {
  @ViewBuilder
  func watchOutProminentButton() -> some View {
#if compiler(>=6.2)
    if #available(macOS 26.0, *) {
      self.buttonStyle(.glassProminent)
    } else {
      self.buttonStyle(.borderedProminent)
    }
#else
    self.buttonStyle(.borderedProminent)
#endif
  }
}
