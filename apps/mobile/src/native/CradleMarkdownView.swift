internal import ExpoModulesCore
import MarkdownView
import UIKit

final class CradleMarkdownView: ExpoView {
  private let markdownView = MarkdownTextView()
  private var markdown = ""
  private var streaming = true
  private var lastReportedSize = CGSize.zero
  private var needsRender = false
  private var renderScheduled = false

  let onContentSizeChange = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    var theme = MarkdownTheme.default
    theme.align(to: 14)
    markdownView.theme = theme
    markdownView.throttleInterval = 1 / 8
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

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, needsRender {
      scheduleRender()
    }
  }

  func setMarkdown(_ value: String) {
    guard value != markdown else { return }
    markdown = value
    scheduleRender()
  }

  func setStreaming(_ value: Bool) {
    guard value != streaming else { return }
    streaming = value
    scheduleRender()
  }

  private func scheduleRender() {
    needsRender = true
    guard window != nil, !renderScheduled else { return }
    renderScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.renderScheduled = false
      guard self.window != nil, self.needsRender else { return }
      self.render()
    }
  }

  private func render() {
    needsRender = false
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
