internal import ExpoModulesCore
import UIKit
import VisionKit

private final class CradleDocumentScannerDelegate: NSObject,
  VNDocumentCameraViewControllerDelegate
{
  let promise: Promise
  var onFinish: (() -> Void)?

  init(promise: Promise) {
    self.promise = promise
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    finish(controller) {
      self.promise.resolve([String]())
    }
  }

  func documentCameraViewController(
    _ controller: VNDocumentCameraViewController,
    didFinishWith scan: VNDocumentCameraScan
  ) {
    var pages: [String] = []
    for index in 0..<scan.pageCount {
      guard let data = scan.imageOfPage(at: index).jpegData(compressionQuality: 0.9) else {
        finish(controller) {
          self.promise.reject(
            "ERR_DOCUMENT_SCAN_ENCODING",
            "A scanned page could not be prepared as an attachment."
          )
        }
        return
      }
      pages.append(data.base64EncodedString())
    }
    finish(controller) {
      self.promise.resolve(pages)
    }
  }

  func documentCameraViewController(
    _ controller: VNDocumentCameraViewController,
    didFailWithError error: any Error
  ) {
    finish(controller) {
      self.promise.reject(error)
    }
  }

  private func finish(
    _ controller: VNDocumentCameraViewController,
    completion: @escaping () -> Void
  ) {
    controller.dismiss(animated: true) { [weak self] in
      completion()
      self?.onFinish?()
    }
  }
}

private final class CradleDocumentScannerUnsupportedException: Exception, @unchecked Sendable {
  override var reason: String {
    "Document scanning is not available on this device."
  }
}

private final class CradleDocumentScannerBusyException: Exception, @unchecked Sendable {
  override var reason: String {
    "A document scanner is already open."
  }
}

private final class CradleDocumentScannerPresenterUnavailableException: Exception, @unchecked Sendable {
  override var reason: String {
    "Cradle could not find a screen from which to present the document scanner."
  }
}

final class CradleDocumentScannerModule: Module {
  private var scannerDelegate: CradleDocumentScannerDelegate?

  func definition() -> ModuleDefinition {
    Name("CradleDocumentScanner")

    AsyncFunction("scan") { [weak self] (promise: Promise) in
      guard VNDocumentCameraViewController.isSupported else {
        promise.reject(CradleDocumentScannerUnsupportedException())
        return
      }
      guard self?.scannerDelegate == nil else {
        promise.reject(CradleDocumentScannerBusyException())
        return
      }
      guard let presenter = self?.appContext?.utilities?.currentViewController() else {
        promise.reject(CradleDocumentScannerPresenterUnavailableException())
        return
      }

      let scannerDelegate = CradleDocumentScannerDelegate(promise: promise)
      scannerDelegate.onFinish = { [weak self] in
        self?.scannerDelegate = nil
      }
      self?.scannerDelegate = scannerDelegate

      let scanner = VNDocumentCameraViewController()
      scanner.delegate = scannerDelegate
      presenter.present(scanner, animated: true)
    }.runOnQueue(.main)
  }
}
