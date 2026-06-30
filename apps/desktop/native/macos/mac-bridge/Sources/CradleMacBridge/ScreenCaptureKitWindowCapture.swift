// Captures frontmost windows with ScreenCaptureKit when the host macOS supports it.
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

struct WindowCaptureResult {
    let backend: String
    let screenCaptureKitError: [String: Any]?
}

struct CaptureImageSize {
    let pixelWidth: Int
    let pixelHeight: Int

    func serialize() -> [String: Any] {
        [
            "pixelWidth": pixelWidth,
            "pixelHeight": pixelHeight,
        ]
    }
}

func captureWindowImage(window: WindowCandidate, filePath: String) throws -> WindowCaptureResult {
    if #available(macOS 14.0, *) {
        do {
            try captureWindowWithScreenCaptureKit(window: window, filePath: filePath)
            return WindowCaptureResult(backend: "screen-capture-kit", screenCaptureKitError: nil)
        } catch {
            if isMissingTargetWindowCaptureError(error) {
                throw error
            }
            try runScreenCapture(windowId: window.windowId, filePath: filePath)
            return WindowCaptureResult(
                backend: "screencapture-fallback",
                screenCaptureKitError: serializeScreenCaptureKitError(error)
            )
        }
    }
    try runScreenCapture(windowId: window.windowId, filePath: filePath)
    return WindowCaptureResult(backend: "screencapture", screenCaptureKitError: nil)
}

func readCaptureImageSize(filePath: String) -> CaptureImageSize? {
    let url = URL(fileURLWithPath: filePath)
    guard let imageSource = CGImageSourceCreateWithURL(url as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(imageSource, 0, nil) as? [CFString: Any],
          let pixelWidth = properties[kCGImagePropertyPixelWidth] as? NSNumber,
          let pixelHeight = properties[kCGImagePropertyPixelHeight] as? NSNumber,
          pixelWidth.intValue > 0,
          pixelHeight.intValue > 0
    else {
        return nil
    }
    return CaptureImageSize(pixelWidth: pixelWidth.intValue, pixelHeight: pixelHeight.intValue)
}

private func isMissingTargetWindowCaptureError(_ error: Error) -> Bool {
    guard let bridgeError = error as? BridgeError else {
        return false
    }
    return bridgeError.code == "screen-capture-kit-window-unavailable"
}

@available(macOS 14.0, *)
private func captureWindowWithScreenCaptureKit(window: WindowCandidate, filePath: String) throws {
    let semaphore = DispatchSemaphore(value: 0)
    final class CaptureBox: @unchecked Sendable {
        private let lock = NSLock()
        var error: Error?

        private var cancelled = false

        func cancel() {
            lock.lock()
            cancelled = true
            lock.unlock()
        }

        func isCancelled() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            return cancelled
        }

        func record(error: Error) {
            lock.lock()
            self.error = error
            lock.unlock()
        }
    }
    let box = CaptureBox()

    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
        if box.isCancelled() {
            semaphore.signal()
            return
        }
        if let error {
            box.record(error: error)
            semaphore.signal()
            return
        }
        guard let content,
              let captureWindow = content.windows.first(where: { Int($0.windowID) == window.windowId })
        else {
            box.record(error: BridgeError("screen-capture-kit-window-unavailable", "ScreenCaptureKit could not find the target window.", details: [
                "windowId": String(window.windowId),
            ]))
            semaphore.signal()
            return
        }

        let filter = SCContentFilter(desktopIndependentWindow: captureWindow)
        let configuration = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale > 0 ? filter.pointPixelScale : Float(NSScreen.main?.backingScaleFactor ?? 2))
        let width = max(Int(captureWindow.frame.width * scale), 1)
        let height = max(Int(captureWindow.frame.height * scale), 1)
        configuration.width = width
        configuration.height = height
        configuration.showsCursor = false
        configuration.captureResolution = .best
        configuration.ignoreShadowsSingleWindow = false

        SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) { image, error in
            if box.isCancelled() {
                semaphore.signal()
                return
            }
            if let error {
                box.record(error: error)
            } else if let image {
                do {
                    try writePNGImage(image, filePath: filePath)
                } catch {
                    box.record(error: error)
                }
            } else {
                box.record(error: BridgeError("screen-capture-kit-empty-image", "ScreenCaptureKit returned no image for the target window."))
            }
            semaphore.signal()
        }
    }

    let timeoutSeconds = 5
    if semaphore.wait(timeout: .now() + .seconds(timeoutSeconds)) == .timedOut {
        box.cancel()
        throw BridgeError("screen-capture-kit-timeout", "ScreenCaptureKit window capture timed out.", details: [
            "timeoutSeconds": String(timeoutSeconds),
            "windowId": String(window.windowId),
        ])
    }
    if let error = box.error {
        throw error
    }
}

private func writePNGImage(_ image: CGImage, filePath: String) throws {
    let url = URL(fileURLWithPath: filePath)
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw BridgeError("png-destination-unavailable", "Could not create PNG destination for ScreenCaptureKit image.")
    }
    CGImageDestinationAddImage(destination, image, nil)
    if !CGImageDestinationFinalize(destination) {
        throw BridgeError("png-write-failed", "Could not write ScreenCaptureKit image as PNG.")
    }
}

func serializeScreenCaptureKitError(_ error: Error) -> [String: Any] {
    if let bridgeError = error as? BridgeError {
        return [
            "code": bridgeError.code,
            "message": bridgeError.message,
            "details": bridgeError.details ?? NSNull(),
        ]
    }
    let nsError = error as NSError
    return [
        "code": "\(nsError.domain):\(nsError.code)",
        "message": nsError.localizedDescription,
        "details": [
            "domain": nsError.domain,
            "code": nsError.code,
        ],
    ]
}

func readScreenCaptureKitDiagnostics() -> [String: Any] {
    guard #available(macOS 13.0, *) else {
        return [
            "supported": false,
            "permissions": permissionStatus(),
            "status": "unsupported",
        ]
    }

    final class DiagnosticsBox: @unchecked Sendable {
        var result: [String: Any]?
    }
    let box = DiagnosticsBox()
    let semaphore = DispatchSemaphore(value: 0)
    Task {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            box.result = readAvailableScreenCaptureKitDiagnostics(content: content)
        } catch {
            box.result = [
                "supported": true,
                "permissions": permissionStatus(),
                "status": "failed",
                "error": serializeScreenCaptureKitError(error),
            ]
        }
        semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + .seconds(8)) == .timedOut {
        return [
            "supported": true,
            "permissions": permissionStatus(),
            "status": "timeout",
        ]
    }
    return box.result ?? [
        "supported": true,
        "permissions": permissionStatus(),
        "status": "empty-result",
    ]
}

@available(macOS 13.0, *)
private func readAvailableScreenCaptureKitDiagnostics(content: SCShareableContent) -> [String: Any] {
    [
        "supported": true,
        "permissions": permissionStatus(),
        "status": "available",
        "displayCount": content.displays.count,
        "windowCount": content.windows.count,
        "applicationCount": content.applications.count,
        "displays": content.displays.map(serializeScreenCaptureKitDisplay),
        "sampleWindows": content.windows.prefix(12).map(serializeScreenCaptureKitWindow),
    ]
}

@available(macOS 13.0, *)
private func serializeScreenCaptureKitDisplay(_ display: SCDisplay) -> [String: Any] {
    [
        "displayId": Int(display.displayID),
        "width": display.width,
        "height": display.height,
    ]
}

@available(macOS 13.0, *)
private func serializeScreenCaptureKitWindow(_ window: SCWindow) -> [String: Any] {
    let frame = window.frame
    return [
        "windowId": Int(window.windowID),
        "title": window.title ?? NSNull(),
        "owningApplication": window.owningApplication?.bundleIdentifier ?? NSNull(),
        "processId": window.owningApplication.map { Int($0.processID) } ?? NSNull(),
        "frame": [
            "x": Double(frame.origin.x),
            "y": Double(frame.origin.y),
            "width": Double(frame.size.width),
            "height": Double(frame.size.height),
        ],
    ]
}
