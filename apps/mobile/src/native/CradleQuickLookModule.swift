internal import ExpoModulesCore
import QuickLook

private final class CradleQuickLookDataSource: NSObject,
  QLPreviewControllerDataSource,
  QLPreviewControllerDelegate
{
  let fileURL: URL
  var onDismiss: (() -> Void)?

  init(fileURL: URL) {
    self.fileURL = fileURL
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
    1
  }

  func previewController(
    _ controller: QLPreviewController,
    previewItemAt index: Int
  ) -> any QLPreviewItem {
    fileURL as NSURL
  }

  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    onDismiss?()
  }
}

private final class CradleQuickLookFileUnavailableException: Exception, @unchecked Sendable {
  override var reason: String {
    "Quick Look requires an existing local file."
  }
}

private final class CradleQuickLookUnsupportedFileException: Exception, @unchecked Sendable {
  override var reason: String {
    "iOS Quick Look does not support this file type."
  }
}

private final class CradleQuickLookPresenterUnavailableException: Exception, @unchecked Sendable {
  override var reason: String {
    "Cradle could not find a screen from which to present Quick Look."
  }
}

final class CradleQuickLookModule: Module {
  private var previewDataSource: CradleQuickLookDataSource?

  func definition() -> ModuleDefinition {
    Name("CradleQuickLook")

    AsyncFunction("preview") { [weak self] (fileURL: URL) in
      guard fileURL.isFileURL, FileManager.default.fileExists(atPath: fileURL.path) else {
        throw CradleQuickLookFileUnavailableException()
      }
      guard QLPreviewController.canPreview(fileURL as NSURL) else {
        throw CradleQuickLookUnsupportedFileException()
      }
      guard let presenter = self?.appContext?.utilities?.currentViewController() else {
        throw CradleQuickLookPresenterUnavailableException()
      }

      let dataSource = CradleQuickLookDataSource(fileURL: fileURL)
      dataSource.onDismiss = { [weak self] in
        self?.previewDataSource = nil
      }
      self?.previewDataSource = dataSource

      let previewController = QLPreviewController()
      previewController.dataSource = dataSource
      previewController.delegate = dataSource
      presenter.present(previewController, animated: true)
    }.runOnQueue(.main)
  }
}
