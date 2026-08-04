import ExpoModulesCore
import MarkdownView
import UIKit

final class CradleMarkdownView: ExpoView {
  private let markdownView = MarkdownTextView(frame: .zero)
  private var markdown = ""
  private var streaming = true
  private var lastReportedSize = CGSize.zero

  let onContentSizeChange = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    var theme = MarkdownTheme.default
    theme.align(to: 14)
    markdownView.theme = theme
    markdownView.throttleInterval = 1 / 20
    markdownView.backgroundColor = .clear

    backgroundColor = .clear
    clipsToBounds = false
    markdownView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(markdownView)

    NSLayoutConstraint.activate([
      markdownView.leadingAnchor.constraint(equalTo: leadingAnchor),
      markdownView.trailingAnchor.constraint(equalTo: trailingAnchor),
      markdownView.topAnchor.constraint(equalTo: topAnchor),
      markdownView.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    markdownView.layoutIfNeeded()

    let intrinsicSize = markdownView.intrinsicContentSize
    let contentSize = CGSize(width: bounds.width, height: intrinsicSize.height)
    guard contentSize != lastReportedSize else { return }
    lastReportedSize = contentSize
    onContentSizeChange([
      "height": contentSize.height,
      "width": contentSize.width,
    ])
  }

  override var intrinsicContentSize: CGSize {
    markdownView.intrinsicContentSize
  }

  func setMarkdown(_ value: String) {
    guard value != markdown else { return }
    markdown = value
    render()
  }

  func setStreaming(_ value: Bool) {
    guard value != streaming else { return }
    streaming = value
    render()
  }

  private func render() {
    let content = MarkdownContent(markdown: markdown, theme: markdownView.theme)
    if streaming {
      markdownView.setContent(content)
    } else {
      markdownView.setContentImmediately(content)
    }
    invalidateIntrinsicContentSize()
    setNeedsLayout()
  }
}
