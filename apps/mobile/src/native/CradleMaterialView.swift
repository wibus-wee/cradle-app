internal import ExpoModulesCore
import UIKit

final class CradleMaterialView: ExpoView {
  private let effectView = UIVisualEffectView()
  private let sheenLayer = CAGradientLayer()
  private var glassStyle = "regular"
  private var tint: UIColor?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    backgroundColor = .clear
    isOpaque = false
    clipsToBounds = true
    layer.cornerCurve = .continuous

    effectView.translatesAutoresizingMaskIntoConstraints = false
    effectView.isUserInteractionEnabled = false
    effectView.clipsToBounds = true
    addSubview(effectView)
    layer.addSublayer(sheenLayer)

    NSLayoutConstraint.activate([
      effectView.leadingAnchor.constraint(equalTo: leadingAnchor),
      effectView.trailingAnchor.constraint(equalTo: trailingAnchor),
      effectView.topAnchor.constraint(equalTo: topAnchor),
      effectView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])

    updateEffect()
  }

  func setGlassStyle(_ value: String) {
    guard value != glassStyle else { return }
    glassStyle = value
    updateEffect()
  }

  private func updateEffect() {
    if #available(iOS 26.0, *) {
      let style: UIGlassEffect.Style = glassStyle == "clear" ? .clear : .regular
      let effect = UIGlassEffect(style: style)
      effect.isInteractive = false
      effect.tintColor = tint
      effectView.effect = effect
    } else {
      effectView.effect = UIBlurEffect(style: .systemMaterial)
    }
    updateSheen()
  }

  func setTintColor(_ value: String?) {
    tint = value.flatMap(Self.color(from:))
    updateEffect()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    sheenLayer.frame = CGRect(x: 0, y: 0, width: bounds.width, height: min(bounds.height * 0.42, 72))
  }

  private func updateSheen() {
    let isDark = traitCollection.userInterfaceStyle == .dark
    let highlight = isDark ? UIColor.white.withAlphaComponent(0.10) : UIColor.white.withAlphaComponent(0.34)
    let fade = isDark ? UIColor.white.withAlphaComponent(0.015) : UIColor.white.withAlphaComponent(0.03)
    sheenLayer.colors = [highlight.cgColor, fade.cgColor, UIColor.clear.cgColor]
    sheenLayer.locations = [0, 0.35, 1]
    sheenLayer.startPoint = CGPoint(x: 0.5, y: 0)
    sheenLayer.endPoint = CGPoint(x: 0.5, y: 1)
  }

  private static func color(from value: String) -> UIColor? {
    let components = value
      .replacingOccurrences(of: "rgba(", with: "")
      .replacingOccurrences(of: "rgb(", with: "")
      .replacingOccurrences(of: ")", with: "")
      .split(separator: ",")
      .compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }

    guard components.count >= 3 else { return nil }
    let alpha = components.count > 3 ? components[3] : 1
    let scale = components[0] > 1 || components[1] > 1 || components[2] > 1 ? 255.0 : 1.0
    return UIColor(
      red: CGFloat(components[0] / scale),
      green: CGFloat(components[1] / scale),
      blue: CGFloat(components[2] / scale),
      alpha: CGFloat(alpha),
    )
  }
}
