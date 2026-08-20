internal import ExpoModulesCore
import UIKit

final class CradleMaterialModule: Module {
  func definition() -> ModuleDefinition {
    Name("CradleMaterial")

    View(CradleMaterialView.self) {
      Prop("glassStyle") { (view: CradleMaterialView, style: String?) in
        view.setGlassStyle(style ?? "regular")
      }

      Prop("tintColor") { (view: CradleMaterialView, color: String?) in
        view.setTintColor(color)
      }
    }
  }
}
