internal import ExpoModulesCore
import MarkdownView

final class CradleMarkdownModule: Module {
  func definition() -> ModuleDefinition {
    Name("CradleMarkdown")

    View(CradleMarkdownView.self) {
      Events("onContentSizeChange")

      Prop("markdown") { (view: CradleMarkdownView, markdown: String?) in
        view.setMarkdown(markdown ?? "")
      }

      Prop("streaming") { (view: CradleMarkdownView, streaming: Bool?) in
        view.setStreaming(streaming ?? true)
      }
    }
  }
}
