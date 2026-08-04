import ExpoModulesCore
import MarkdownView

public final class CradleMarkdownModule: Module {
  public func definition() -> ModuleDefinition {
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
