import SwiftUI
import WatchOutUI

@main
struct WatchOutApp: App {
  @State private var model = WatchOutAppModel()

  var body: some Scene {
    WatchOutRootScene(model: model)
  }
}
