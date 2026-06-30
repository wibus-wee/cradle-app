// Records whole-display video evidence with ScreenCaptureKit for Appshot parity reports.
import AppKit
@preconcurrency import AVFoundation
import CoreGraphics
import CoreMedia
import CoreVideo
import Foundation
import IOSurface
import ScreenCaptureKit

final class DisplayRecordingRegistry: @unchecked Sendable {
    private let lock = NSLock()
    private var recordings: [String: Any] = [:]

    func start(params: [String: Any]) throws -> [String: Any] {
        guard #available(macOS 13.0, *) else {
            throw BridgeError("screen-recording-unsupported", "ScreenCaptureKit display recording requires macOS 13 or newer.")
        }
        guard let outputPath = params["outputPath"] as? String, !outputPath.isEmpty else {
            throw BridgeError("invalid-params", "mac.recording.startDisplay requires outputPath.")
        }
        let recordingId = params["recordingId"] as? String ?? "display-recording-\(Int(Date().timeIntervalSince1970 * 1000))"
        let frameRate = readPositiveDouble(params["frameRate"]) ?? 30
        let displayId = readOptionalDisplayId(params)

        lock.lock()
        let alreadyRecording = recordings[recordingId] != nil
        lock.unlock()
        if alreadyRecording {
            throw BridgeError("screen-recording-duplicate-id", "A display recording with this id already exists.", details: [
                "recordingId": recordingId,
            ])
        }

        let recorder = try startRecording(
            recordingId: recordingId,
            outputPath: outputPath,
            frameRate: frameRate,
            displayId: displayId
        )
        let result = recorder.startResult
        lock.lock()
        recordings[recordingId] = recorder
        lock.unlock()
        return result
    }

    func finish(params: [String: Any]) throws -> [String: Any] {
        guard #available(macOS 13.0, *) else {
            throw BridgeError("screen-recording-unsupported", "ScreenCaptureKit display recording requires macOS 13 or newer.")
        }
        guard let recordingId = params["recordingId"] as? String, !recordingId.isEmpty else {
            throw BridgeError("invalid-params", "mac.recording.finishDisplay requires recordingId.")
        }
        lock.lock()
        let rawRecorder = recordings.removeValue(forKey: recordingId)
        lock.unlock()
        guard let recorder = rawRecorder as? DisplayRecording else {
            throw BridgeError("screen-recording-not-found", "No active display recording exists for this id.", details: [
                "recordingId": recordingId,
            ])
        }
        return try recorder.finish()
    }

    func startWindow(params: [String: Any]) throws -> [String: Any] {
        guard let outputPath = params["outputPath"] as? String, !outputPath.isEmpty else {
            throw BridgeError("invalid-params", "mac.recording.startWindow requires outputPath.")
        }
        let recordingId = params["recordingId"] as? String ?? "window-recording-\(Int(Date().timeIntervalSince1970 * 1000))"
        let frameRate = readPositiveDouble(params["frameRate"]) ?? 30
        let target = try WindowRecordingTarget.from(params: params)
        let recordingBackend = params["recordingBackend"] as? String ?? "screen-capture-kit-window"

        lock.lock()
        let alreadyRecording = recordings[recordingId] != nil
        lock.unlock()
        if alreadyRecording {
            throw BridgeError("screen-recording-duplicate-id", "A recording with this id already exists.", details: [
                "recordingId": recordingId,
            ])
        }

        let recorder: DisplayRecording
        if recordingBackend == "core-graphics-window-polling" {
            recorder = CoreGraphicsWindowRecorder(
                recordingId: recordingId,
                outputPath: outputPath,
                frameRate: frameRate,
                target: target
            )
        } else if recordingBackend == "screen-capture-kit-window" {
            guard #available(macOS 13.0, *) else {
                throw BridgeError("screen-recording-unsupported", "ScreenCaptureKit window recording requires macOS 13 or newer.")
            }
            recorder = ScreenCaptureKitWindowRecorder(
                recordingId: recordingId,
                outputPath: outputPath,
                frameRate: frameRate,
                target: target
            )
        } else {
            throw BridgeError("invalid-params", "Unsupported window recording backend.", details: [
                "recordingBackend": recordingBackend,
            ])
        }
        try recorder.start()
        let result = recorder.startResult
        lock.lock()
        recordings[recordingId] = recorder
        lock.unlock()
        return result
    }

    private func startRecording(
        recordingId: String,
        outputPath: String,
        frameRate: Double,
        displayId: CGDirectDisplayID?
    ) throws -> DisplayRecording {
        if #available(macOS 13.0, *) {
            do {
                let recorder = ScreenCaptureKitDisplayRecorder(
                    recordingId: recordingId,
                    outputPath: outputPath,
                    frameRate: frameRate,
                    displayId: displayId
                )
                try recorder.start()
                return recorder
            } catch {
                let recorder = CoreGraphicsDisplayRecorder(
                    recordingId: recordingId,
                    outputPath: outputPath,
                    frameRate: frameRate,
                    displayId: displayId,
                    fallbackError: serializeRecordingError(error)
                )
                try recorder.start()
                return recorder
            }
        }
        let recorder = CoreGraphicsDisplayRecorder(
            recordingId: recordingId,
            outputPath: outputPath,
            frameRate: frameRate,
            displayId: displayId,
            fallbackError: nil
        )
        try recorder.start()
        return recorder
    }
}

private protocol DisplayRecording: AnyObject {
    var startResult: [String: Any] { get }
    func start() throws
    func finish() throws -> [String: Any]
}

private final class CoreGraphicsDisplayRecorder: DisplayRecording, @unchecked Sendable {
    private static let backendName = "core-graphics-window-list-polling"
    private let recordingId: String
    private let outputPath: String
    private let frameRate: Double
    private let requestedDisplayId: CGDirectDisplayID?
    private let fallbackError: [String: Any]?
    private let queue = DispatchQueue(label: "app.cradle.mac-bridge.core-graphics-display-recorder")
    private var timer: DispatchSourceTimer?
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var firstSampleTime: CMTime?
    private var lastSampleTime: CMTime?
    private var frameCount = 0
    private var recordingStartedAtNanoseconds: UInt64?
    private var displayId: CGDirectDisplayID = CGMainDisplayID()
    private var width = 0
    private var height = 0
    private var startedPayload: [String: Any] = [:]

    init(
        recordingId: String,
        outputPath: String,
        frameRate: Double,
        displayId: CGDirectDisplayID?,
        fallbackError: [String: Any]?
    ) {
        self.recordingId = recordingId
        self.outputPath = outputPath
        self.frameRate = frameRate
        self.requestedDisplayId = displayId
        self.fallbackError = fallbackError
    }

    var startResult: [String: Any] {
        startedPayload
    }

    func start() throws {
        let outputURL = URL(fileURLWithPath: outputPath)
        try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: outputURL)

        displayId = requestedDisplayId ?? CGMainDisplayID()
        let bounds = CGDisplayBounds(displayId)
        width = max(Int(bounds.width), 1)
        height = max(Int(bounds.height), 1)

        let selectedWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
        let selectedInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
        ])
        selectedInput.expectsMediaDataInRealTime = true
        guard selectedWriter.canAdd(selectedInput) else {
            throw BridgeError("screen-recording-writer-input-unavailable", "AVAssetWriter cannot accept the CoreGraphics display recording input.")
        }
        selectedWriter.add(selectedInput)
        let selectedAdaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: selectedInput,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:],
            ]
        )

        writer = selectedWriter
        input = selectedInput
        adaptor = selectedAdaptor
        selectedWriter.startWriting()
        selectedWriter.startSession(atSourceTime: .zero)
        firstSampleTime = .zero
        recordingStartedAtNanoseconds = DispatchTime.now().uptimeNanoseconds
        startFrameTimer()

        startedPayload = [
            "recordingId": recordingId,
            "outputPath": outputPath,
            "backend": Self.backendName,
            "displayId": Int(displayId),
            "width": width,
            "height": height,
            "frameRate": frameRate,
            "fallbackFrom": "screen-capture-kit-display",
            "fallbackError": fallbackError ?? NSNull(),
            "startedAt": isoTimestamp(),
        ]
    }

    func finish() throws -> [String: Any] {
        timer?.cancel()
        timer = nil
        try finishWriter()
        let durationSeconds = lastSampleTime.flatMap { last in
            firstSampleTime.map { first in CMTimeGetSeconds(CMTimeSubtract(last, first)) }
        } ?? 0
        return [
            "recordingId": recordingId,
            "outputPath": outputPath,
            "backend": Self.backendName,
            "displayId": Int(displayId),
            "width": width,
            "height": height,
            "frameRate": frameRate,
            "frameCount": frameCount,
            "durationSeconds": durationSeconds,
            "fallbackFrom": "screen-capture-kit-display",
            "fallbackError": fallbackError ?? NSNull(),
            "finishedAt": isoTimestamp(),
        ]
    }

    private func startFrameTimer() {
        let selectedTimer = DispatchSource.makeTimerSource(queue: queue)
        let intervalNanoseconds = UInt64(1_000_000_000 / max(frameRate, 1))
        selectedTimer.schedule(deadline: .now(), repeating: .nanoseconds(Int(intervalNanoseconds)))
        selectedTimer.setEventHandler { [weak self] in
            self?.appendDisplayFrame()
        }
        timer = selectedTimer
        selectedTimer.resume()
    }

    private func appendDisplayFrame() {
        guard let image = createWindowListImage(),
              let writer,
              let input,
              let adaptor,
              let pool = adaptor.pixelBufferPool
        else {
            return
        }
        var pixelBuffer: CVPixelBuffer?
        let bufferStatus = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer)
        guard bufferStatus == kCVReturnSuccess,
              let pixelBuffer
        else {
            return
        }
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer {
            CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
        }
        guard let context = CGContext(
            data: CVPixelBufferGetBaseAddress(pixelBuffer),
            width: CVPixelBufferGetWidth(pixelBuffer),
            height: CVPixelBufferGetHeight(pixelBuffer),
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else {
            return
        }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        let sampleTime = readElapsedSampleTime()
        guard writer.status == .writing, input.isReadyForMoreMediaData else {
            return
        }
        if adaptor.append(pixelBuffer, withPresentationTime: sampleTime) {
            frameCount += 1
            lastSampleTime = sampleTime
        }
    }

    private func readElapsedSampleTime() -> CMTime {
        guard let recordingStartedAtNanoseconds else {
            return .zero
        }
        let elapsedNanoseconds = DispatchTime.now().uptimeNanoseconds - recordingStartedAtNanoseconds
        return CMTime(value: CMTimeValue(elapsedNanoseconds), timescale: 1_000_000_000)
    }

    private func createWindowListImage() -> CGImage? {
        CGWindowListCreateImage(
            CGDisplayBounds(displayId),
            .optionOnScreenOnly,
            kCGNullWindowID,
            [.bestResolution]
        )
    }

    private func finishWriter() throws {
        final class FinishBox: @unchecked Sendable {
            var error: Error?
        }
        let box = FinishBox()
        let semaphore = DispatchSemaphore(value: 0)
        queue.async {
            guard let writer = self.writer else {
                semaphore.signal()
                return
            }
            if writer.status == .writing {
                self.input?.markAsFinished()
                writer.finishWriting {
                    box.error = writer.error
                    semaphore.signal()
                }
            } else {
                box.error = writer.error
                semaphore.signal()
            }
        }
        if semaphore.wait(timeout: .now() + .seconds(8)) == .timedOut {
            throw BridgeError("core-graphics-display-stream-finish-timeout", "CoreGraphics display recording finish timed out.")
        }
        if let error = box.error {
            throw error
        }
    }
}

@available(macOS 13.0, *)
private final class ScreenCaptureKitDisplayRecorder: NSObject, SCStreamOutput, DisplayRecording, @unchecked Sendable {
    private let recordingId: String
    private let outputPath: String
    private let frameRate: Double
    private let requestedDisplayId: CGDirectDisplayID?
    private let queue = DispatchQueue(label: "app.cradle.mac-bridge.display-recorder")
    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var startedAt: Date?
    private var firstSampleTime: CMTime?
    private var lastSampleTime: CMTime?
    private var frameCount = 0
    private var displayId: CGDirectDisplayID?
    private var width = 0
    private var height = 0
    private var startedPayload: [String: Any] = [:]
    private var startError: Error?
    private var finishError: Error?

    init(recordingId: String, outputPath: String, frameRate: Double, displayId: CGDirectDisplayID?) {
        self.recordingId = recordingId
        self.outputPath = outputPath
        self.frameRate = frameRate
        self.requestedDisplayId = displayId
    }

    var startResult: [String: Any] {
        startedPayload
    }

    func start() throws {
        let semaphore = DispatchSemaphore(value: 0)
        Task {
            do {
                try await startAsync()
            } catch {
                startError = error
            }
            semaphore.signal()
        }
        if semaphore.wait(timeout: .now() + .seconds(8)) == .timedOut {
            throw BridgeError("screen-recording-start-timeout", "ScreenCaptureKit display recording start timed out.")
        }
        if let startError {
            throw startError
        }
        startedPayload = [
            "recordingId": recordingId,
            "outputPath": outputPath,
            "backend": "screen-capture-kit-display",
            "displayId": displayId.map { Int($0) } ?? NSNull(),
            "width": width,
            "height": height,
            "frameRate": frameRate,
            "startedAt": isoTimestamp(),
        ]
    }

    func finish() throws -> [String: Any] {
        let semaphore = DispatchSemaphore(value: 0)
        Task {
            do {
                try await finishAsync()
            } catch {
                finishError = error
            }
            semaphore.signal()
        }
        if semaphore.wait(timeout: .now() + .seconds(8)) == .timedOut {
            throw BridgeError("screen-recording-finish-timeout", "ScreenCaptureKit display recording finish timed out.")
        }
        if let finishError {
            throw finishError
        }
        let durationSeconds = lastSampleTime.flatMap { last in
            firstSampleTime.map { first in CMTimeGetSeconds(CMTimeSubtract(last, first)) }
        } ?? 0
        return [
            "recordingId": recordingId,
            "outputPath": outputPath,
            "backend": "screen-capture-kit-display",
            "displayId": displayId.map { Int($0) } ?? NSNull(),
            "width": width,
            "height": height,
            "frameRate": frameRate,
            "frameCount": frameCount,
            "durationSeconds": durationSeconds,
            "finishedAt": isoTimestamp(),
        ]
    }

    private func startAsync() async throws {
        let outputURL = URL(fileURLWithPath: outputPath)
        try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: outputURL)

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        let display = try selectDisplay(from: content.displays)
        displayId = display.displayID
        width = max(display.width, 1)
        height = max(display.height, 1)

        let configuration = SCStreamConfiguration()
        configuration.width = width
        configuration.height = height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(max(Int(frameRate.rounded()), 1)))
        configuration.showsCursor = true
        if #available(macOS 14.0, *) {
            configuration.captureResolution = .best
        }

        let selectedFilter = SCContentFilter(display: display, excludingWindows: [])
        let selectedStream = SCStream(filter: selectedFilter, configuration: configuration, delegate: nil)
        try selectedStream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)

        let selectedWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
        let selectedInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
        ])
        selectedInput.expectsMediaDataInRealTime = true
        guard selectedWriter.canAdd(selectedInput) else {
            throw BridgeError("screen-recording-writer-input-unavailable", "AVAssetWriter cannot accept the display recording input.")
        }
        selectedWriter.add(selectedInput)

        writer = selectedWriter
        input = selectedInput
        stream = selectedStream
        startedAt = Date()
        try await selectedStream.startCapture()
    }

    private func finishAsync() async throws {
        if let stream {
            do {
                try await stream.stopCapture()
            } catch {
                if !isAlreadyStoppedStreamError(error) {
                    throw error
                }
            }
        }
        try finishWriter()
    }

    private func finishWriter() throws {
        final class FinishBox: @unchecked Sendable {
            var error: Error?
        }
        let box = FinishBox()
        let semaphore = DispatchSemaphore(value: 0)
        queue.async {
            guard let writer = self.writer else {
                semaphore.signal()
                return
            }
            if writer.status == .writing {
                self.input?.markAsFinished()
                writer.finishWriting {
                    box.error = writer.error
                    semaphore.signal()
                }
            } else {
                box.error = writer.error
                semaphore.signal()
            }
        }
        if semaphore.wait(timeout: .now() + .seconds(8)) == .timedOut {
            throw BridgeError("screen-recording-writer-finish-timeout", "ScreenCaptureKit display recording writer finish timed out.")
        }
        if let error = box.error {
            throw error
        }
    }

    private func selectDisplay(from displays: [SCDisplay]) throws -> SCDisplay {
        if let requestedDisplayId,
           let display = displays.first(where: { $0.displayID == requestedDisplayId }) {
            return display
        }
        if let mainDisplay = displays.first(where: { $0.displayID == CGMainDisplayID() }) {
            return mainDisplay
        }
        guard let firstDisplay = displays.first else {
            throw BridgeError("screen-recording-display-unavailable", "ScreenCaptureKit did not return any displays.")
        }
        return firstDisplay
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .screen,
              sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              attachments.first?[.status] as? SCFrameStatus == .complete,
              let writer,
              let input
        else {
            return
        }

        let sampleTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if firstSampleTime == nil {
            firstSampleTime = sampleTime
            writer.startWriting()
            writer.startSession(atSourceTime: sampleTime)
        }
        guard writer.status == .writing, input.isReadyForMoreMediaData else {
            return
        }
        if input.append(sampleBuffer) {
            frameCount += 1
            lastSampleTime = sampleTime
        }
    }
}

private func isAlreadyStoppedStreamError(_ error: Error) -> Bool {
    let nsError = error as NSError
    return nsError.domain == "com.apple.ScreenCaptureKit.SCStreamErrorDomain" && nsError.code == -3808
}

private struct WindowRecordingTarget {
    let windowId: Int?
    let processId: Int?
    let bundleIdentifier: String?
    let displayBounds: CGRect?
    let discoveryTimeoutSeconds: Double
    let discoveryPollIntervalSeconds: Double
    let captureSecondsAfterDiscovery: Double

    static func from(params: [String: Any]) throws -> WindowRecordingTarget {
        let rawWindowId = readOptionalPositiveInteger(params["windowId"])
        let rawProcessId = readOptionalPositiveInteger(params["processId"])
        let rawBundleIdentifier = (params["bundleIdentifier"] as? String).flatMap { value in
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        if rawWindowId == nil && rawProcessId == nil && rawBundleIdentifier == nil {
            throw BridgeError("invalid-params", "mac.recording.startWindow requires windowId, processId, or bundleIdentifier.")
        }
        return WindowRecordingTarget(
            windowId: rawWindowId,
            processId: rawProcessId,
            bundleIdentifier: rawBundleIdentifier,
            displayBounds: readOptionalRect(params["displayBounds"] as? [String: Any]),
            discoveryTimeoutSeconds: readPositiveDouble(params["discoveryTimeoutSeconds"]) ?? 2,
            discoveryPollIntervalSeconds: readPositiveDouble(params["discoveryPollIntervalSeconds"]) ?? 0.04,
            captureSecondsAfterDiscovery: readPositiveDouble(params["captureSecondsAfterDiscovery"]) ?? 1.2
        )
    }
}

private final class CoreGraphicsWindowRecorder: DisplayRecording, @unchecked Sendable {
    private static let backendName = "core-graphics-window-polling"
    private let recordingId: String
    private let outputPath: String
    private let frameRate: Double
    private let target: WindowRecordingTarget
    private let queue = DispatchQueue(label: "app.cradle.mac-bridge.core-graphics-window-recorder")
    private var timer: DispatchSourceTimer?
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var firstSampleTime: CMTime?
    private var lastSampleTime: CMTime?
    private var recordingStartedAtNanoseconds: UInt64?
    private var frameCount = 0
    private var selectedWindowId: Int?
    private var selectedProcessId: Int?
    private var selectedOwnerName: String?
    private var selectedTitle: String?
    private var selectedBounds: CGRect?
    private var selectedAtNanoseconds: UInt64?
    private var observedWindowIds: Set<Int> = []
    private var captureCompleted = false
    private var imageMissCount = 0
    private var windowRediscoveryCount = 0
    private var width = 1
    private var height = 1
    private var startedPayload: [String: Any] = [:]

    init(recordingId: String, outputPath: String, frameRate: Double, target: WindowRecordingTarget) {
        self.recordingId = recordingId
        self.outputPath = outputPath
        self.frameRate = frameRate
        self.target = target
    }

    var startResult: [String: Any] {
        startedPayload
    }

    func start() throws {
        let outputURL = URL(fileURLWithPath: outputPath)
        try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: outputURL)

        if let displayBounds = target.displayBounds {
            width = max(Int(ceil(displayBounds.width)), 1)
            height = max(Int(ceil(displayBounds.height)), 1)
        }

        let selectedWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
        let selectedInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
        ])
        selectedInput.expectsMediaDataInRealTime = true
        guard selectedWriter.canAdd(selectedInput) else {
            throw BridgeError("screen-recording-writer-input-unavailable", "AVAssetWriter cannot accept the CoreGraphics window recording input.")
        }
        selectedWriter.add(selectedInput)

        let selectedAdaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: selectedInput,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:],
            ]
        )

        writer = selectedWriter
        input = selectedInput
        adaptor = selectedAdaptor
        selectedWriter.startWriting()
        selectedWriter.startSession(atSourceTime: .zero)
        firstSampleTime = .zero
        recordingStartedAtNanoseconds = DispatchTime.now().uptimeNanoseconds
        startFrameTimer()

        startedPayload = [
            "recordingId": recordingId,
            "outputPath": outputPath,
            "backend": Self.backendName,
            "displayId": NSNull(),
            "width": width,
            "height": height,
            "frameRate": frameRate,
            "windowId": target.windowId ?? NSNull(),
            "processId": target.processId ?? NSNull(),
            "bundleIdentifier": target.bundleIdentifier ?? NSNull(),
            "displayBounds": target.displayBounds.map { serialize(rect: $0) } ?? NSNull(),
            "discoveryTimeoutSeconds": target.discoveryTimeoutSeconds,
            "discoveryPollIntervalSeconds": target.discoveryPollIntervalSeconds,
            "captureSecondsAfterDiscovery": target.captureSecondsAfterDiscovery,
            "startedAt": isoTimestamp(),
        ]
    }

    func finish() throws -> [String: Any] {
        waitForPostDiscoveryCapture()
        timer?.cancel()
        timer = nil
        try finishWriter()
        guard let selectedWindowId else {
            throw BridgeError("core-graphics-window-recording-window-unavailable", "CoreGraphics could not find the requested window before finish.", details: [
                "recordingId": recordingId,
                "windowId": String(target.windowId ?? 0),
                "processId": String(target.processId ?? 0),
                "bundleIdentifier": target.bundleIdentifier ?? "",
            ])
        }
        guard frameCount > 0 else {
            throw BridgeError("core-graphics-window-recording-empty", "CoreGraphics window recording did not capture any frames.", details: [
                "recordingId": recordingId,
                "windowId": String(selectedWindowId),
                "processId": String(selectedProcessId ?? 0),
                "imageMissCount": String(imageMissCount),
            ])
        }
        let durationSeconds = lastSampleTime.flatMap { last in
            firstSampleTime.map { first in CMTimeGetSeconds(CMTimeSubtract(last, first)) }
        } ?? 0
        return [
            "recordingId": recordingId,
            "outputPath": outputPath,
            "backend": Self.backendName,
            "displayId": NSNull(),
            "width": width,
            "height": height,
            "frameRate": frameRate,
            "frameCount": frameCount,
            "durationSeconds": durationSeconds,
            "windowId": selectedWindowId,
            "processId": selectedProcessId ?? NSNull(),
            "bundleIdentifier": NSNull(),
            "ownerName": selectedOwnerName ?? NSNull(),
            "title": selectedTitle ?? NSNull(),
            "windowBounds": selectedBounds.map { serialize(rect: $0) } ?? NSNull(),
            "imageMissCount": imageMissCount,
            "observedWindowIds": Array(observedWindowIds).sorted(),
            "windowRediscoveryCount": windowRediscoveryCount,
            "captureSecondsAfterDiscovery": target.captureSecondsAfterDiscovery,
            "finishedAt": isoTimestamp(),
        ]
    }

    private func waitForPostDiscoveryCapture() {
        guard selectedWindowId != nil else {
            return
        }
        let timeout = Date().addingTimeInterval(max(target.captureSecondsAfterDiscovery, 0.1) + 0.5)
        while Date() < timeout {
            if captureCompleted {
                return
            }
            Thread.sleep(forTimeInterval: 0.03)
        }
    }

    private func startFrameTimer() {
        let selectedTimer = DispatchSource.makeTimerSource(queue: queue)
        let intervalNanoseconds = UInt64(1_000_000_000 / max(frameRate, 1))
        selectedTimer.schedule(deadline: .now(), repeating: .nanoseconds(Int(intervalNanoseconds)))
        selectedTimer.setEventHandler { [weak self] in
            self?.appendWindowFrame()
        }
        timer = selectedTimer
        selectedTimer.resume()
    }

    private func appendWindowFrame() {
        if selectedWindowId == nil {
            selectWindow()
        }
        guard let selectedWindowId,
              let image = createWindowImage(windowId: selectedWindowId, bounds: selectedBounds),
              let writer,
              let input,
              let adaptor,
              let pool = adaptor.pixelBufferPool
        else {
            if selectedWindowId != nil {
                imageMissCount += 1
                self.selectedWindowId = nil
                windowRediscoveryCount += 1
            }
            return
        }
        var pixelBuffer: CVPixelBuffer?
        let bufferStatus = CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer)
        guard bufferStatus == kCVReturnSuccess,
              let pixelBuffer
        else {
            return
        }
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer {
            CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
        }
        guard let context = CGContext(
            data: CVPixelBufferGetBaseAddress(pixelBuffer),
            width: CVPixelBufferGetWidth(pixelBuffer),
            height: CVPixelBufferGetHeight(pixelBuffer),
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else {
            return
        }
        context.clear(CGRect(x: 0, y: 0, width: width, height: height))
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        let sampleTime = readElapsedSampleTime()
        guard writer.status == .writing, input.isReadyForMoreMediaData else {
            return
        }
        if adaptor.append(pixelBuffer, withPresentationTime: sampleTime) {
            frameCount += 1
            lastSampleTime = sampleTime
            updateCaptureCompletion()
        }
    }

    private func selectWindow() {
        let rawWindows = (try? readRawWindowInventory()) ?? []
        guard let raw = rawWindows.first(where: matchesWindow) else {
            return
        }
        selectedWindowId = readInteger(raw[kCGWindowNumber as String])
        selectedProcessId = readInteger(raw[kCGWindowOwnerPID as String])
        selectedOwnerName = raw[kCGWindowOwnerName as String] as? String
        selectedTitle = raw[kCGWindowName as String] as? String
        selectedBounds = readCGRect(raw[kCGWindowBounds as String])
        if let selectedWindowId {
            observedWindowIds.insert(selectedWindowId)
        }
        if selectedAtNanoseconds == nil {
            selectedAtNanoseconds = DispatchTime.now().uptimeNanoseconds
        }
    }

    private func updateCaptureCompletion() {
        guard let selectedAtNanoseconds else {
            return
        }
        let elapsedNanoseconds = DispatchTime.now().uptimeNanoseconds - selectedAtNanoseconds
        let elapsedSeconds = Double(elapsedNanoseconds) / 1_000_000_000
        if elapsedSeconds >= target.captureSecondsAfterDiscovery {
            captureCompleted = true
        }
    }

    private func matchesWindow(_ raw: [String: Any]) -> Bool {
        guard let windowId = readInteger(raw[kCGWindowNumber as String]),
              let ownerPid = readInteger(raw[kCGWindowOwnerPID as String])
        else {
            return false
        }
        if let targetWindowId = target.windowId, windowId != targetWindowId {
            return false
        }
        if let targetProcessId = target.processId, ownerPid != targetProcessId {
            return false
        }
        if let bundleIdentifier = target.bundleIdentifier {
            let application = NSRunningApplication(processIdentifier: pid_t(ownerPid))
            if application?.bundleIdentifier != bundleIdentifier {
                return false
            }
        }
        if let displayBounds = target.displayBounds,
           let bounds = readCGRect(raw[kCGWindowBounds as String]),
           !isLikelyOverlayFrame(bounds, inside: displayBounds) {
            return false
        }
        return true
    }

    private func createWindowImage(windowId: Int, bounds: CGRect?) -> CGImage? {
        CGWindowListCreateImage(
            bounds ?? .null,
            .optionIncludingWindow,
            CGWindowID(windowId),
            [.bestResolution]
        )
    }

    private func readElapsedSampleTime() -> CMTime {
        guard let recordingStartedAtNanoseconds else {
            return .zero
        }
        let elapsedNanoseconds = DispatchTime.now().uptimeNanoseconds - recordingStartedAtNanoseconds
        return CMTime(value: CMTimeValue(elapsedNanoseconds), timescale: 1_000_000_000)
    }

    private func finishWriter() throws {
        final class FinishBox: @unchecked Sendable {
            var error: Error?
        }
        let box = FinishBox()
        let semaphore = DispatchSemaphore(value: 0)
        queue.async {
            guard let writer = self.writer else {
                semaphore.signal()
                return
            }
            if writer.status == .writing {
                self.input?.markAsFinished()
                writer.finishWriting {
                    box.error = writer.error
                    semaphore.signal()
                }
            } else {
                box.error = writer.error
                semaphore.signal()
            }
        }
        if semaphore.wait(timeout: .now() + .seconds(8)) == .timedOut {
            throw BridgeError("core-graphics-window-stream-finish-timeout", "CoreGraphics window recording finish timed out.")
        }
        if let error = box.error {
            throw error
        }
    }

    private func isLikelyOverlayFrame(_ frame: CGRect, inside displayBounds: CGRect) -> Bool {
        let widthDelta = abs(frame.width - displayBounds.width)
        let heightDelta = abs(frame.height - displayBounds.height)
        let originXDelta = abs(frame.minX - displayBounds.minX)
        let originYDelta = abs(frame.minY - displayBounds.minY)
        let tolerance: CGFloat = 8
        return widthDelta <= tolerance
            && heightDelta <= tolerance
            && originXDelta <= tolerance
            && originYDelta <= tolerance
    }
}

@available(macOS 13.0, *)
private final class ScreenCaptureKitWindowRecorder: NSObject, SCStreamOutput, DisplayRecording, @unchecked Sendable {
    private let recordingId: String
    private let outputPath: String
    private let frameRate: Double
    private let target: WindowRecordingTarget
    private let queue = DispatchQueue(label: "app.cradle.mac-bridge.window-recorder")
    private var stream: SCStream?
    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var discoveryTask: Task<Void, Never>?
    private var startError: Error?
    private var finishError: Error?
    private var selectedWindowId: Int?
    private var selectedProcessId: Int?
    private var selectedBundleIdentifier: String?
    private var width = 0
    private var height = 0
    private var frameCount = 0
    private var firstSampleTime: CMTime?
    private var lastSampleTime: CMTime?
    private var stopped = false
    private var startedPayload: [String: Any] = [:]

    init(recordingId: String, outputPath: String, frameRate: Double, target: WindowRecordingTarget) {
        self.recordingId = recordingId
        self.outputPath = outputPath
        self.frameRate = frameRate
        self.target = target
    }

    var startResult: [String: Any] {
        startedPayload
    }

    func start() throws {
        let outputURL = URL(fileURLWithPath: outputPath)
        try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: outputURL)

        discoveryTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.discoverAndStartStream()
            } catch {
                if !isAlreadyStoppedStreamError(error) {
                    self.startError = error
                }
            }
        }

        startedPayload = [
            "recordingId": recordingId,
            "outputPath": outputPath,
            "backend": "screen-capture-kit-window",
            "displayId": NSNull(),
            "width": 1,
            "height": 1,
            "frameRate": frameRate,
            "windowId": target.windowId ?? NSNull(),
            "processId": target.processId ?? NSNull(),
            "bundleIdentifier": target.bundleIdentifier ?? NSNull(),
            "displayBounds": target.displayBounds.map { serialize(rect: $0) } ?? NSNull(),
            "discoveryTimeoutSeconds": target.discoveryTimeoutSeconds,
            "discoveryPollIntervalSeconds": target.discoveryPollIntervalSeconds,
            "startedAt": isoTimestamp(),
        ]
    }

    func finish() throws -> [String: Any] {
        stopped = true
        discoveryTask?.cancel()

        let semaphore = DispatchSemaphore(value: 0)
        Task {
            do {
                try await finishAsync()
            } catch {
                finishError = error
            }
            semaphore.signal()
        }
        if semaphore.wait(timeout: .now() + .seconds(8)) == .timedOut {
            throw BridgeError("screen-window-recording-finish-timeout", "ScreenCaptureKit window recording finish timed out.")
        }
        if let finishError {
            throw finishError
        }
        if let startError {
            throw startError
        }
        guard frameCount > 0 else {
            throw BridgeError("screen-window-recording-empty", "ScreenCaptureKit window recording did not receive any frames.", details: [
                "recordingId": recordingId,
                "windowId": String(selectedWindowId ?? target.windowId ?? 0),
                "processId": String(selectedProcessId ?? target.processId ?? 0),
                "bundleIdentifier": selectedBundleIdentifier ?? target.bundleIdentifier ?? "",
            ])
        }
        let durationSeconds = lastSampleTime.flatMap { last in
            firstSampleTime.map { first in CMTimeGetSeconds(CMTimeSubtract(last, first)) }
        } ?? 0
        return [
            "recordingId": recordingId,
            "outputPath": outputPath,
            "backend": "screen-capture-kit-window",
            "displayId": NSNull(),
            "width": width,
            "height": height,
            "frameRate": frameRate,
            "frameCount": frameCount,
            "durationSeconds": durationSeconds,
            "windowId": readOptionalPayloadValue(selectedWindowId ?? target.windowId),
            "processId": readOptionalPayloadValue(selectedProcessId ?? target.processId),
            "bundleIdentifier": readOptionalPayloadValue(selectedBundleIdentifier ?? target.bundleIdentifier),
            "finishedAt": isoTimestamp(),
        ]
    }

    private func discoverAndStartStream() async throws {
        let deadline = Date().addingTimeInterval(target.discoveryTimeoutSeconds)
        while Date() < deadline && !Task.isCancelled {
            if stopped {
                return
            }
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            if let window = selectWindow(from: content.windows) {
                if stopped || Task.isCancelled {
                    return
                }
                try await startStream(window: window)
                return
            }
            let pollInterval = UInt64(max(target.discoveryPollIntervalSeconds, 0.02) * 1_000_000_000)
            try await Task.sleep(nanoseconds: pollInterval)
        }
        throw BridgeError("screen-window-recording-window-unavailable", "ScreenCaptureKit could not find the requested window before the discovery timeout.", details: [
            "recordingId": recordingId,
            "windowId": String(target.windowId ?? 0),
            "processId": String(target.processId ?? 0),
            "bundleIdentifier": target.bundleIdentifier ?? "",
            "discoveryTimeoutSeconds": String(target.discoveryTimeoutSeconds),
        ])
    }

    private func startStream(window: SCWindow) async throws {
        if stopped || Task.isCancelled {
            return
        }

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let scale: CGFloat
        if #available(macOS 14.0, *) {
            scale = CGFloat(filter.pointPixelScale > 0 ? filter.pointPixelScale : Float(NSScreen.main?.backingScaleFactor ?? 2))
        } else {
            scale = NSScreen.main?.backingScaleFactor ?? 2
        }
        width = max(Int(ceil(window.frame.width * scale)), 1)
        height = max(Int(ceil(window.frame.height * scale)), 1)
        selectedWindowId = Int(window.windowID)
        selectedProcessId = window.owningApplication.map { Int($0.processID) }
        selectedBundleIdentifier = window.owningApplication?.bundleIdentifier

        let configuration = SCStreamConfiguration()
        configuration.width = width
        configuration.height = height
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(max(Int(frameRate.rounded()), 1)))
        configuration.showsCursor = false
        if #available(macOS 14.0, *) {
            configuration.captureResolution = .best
            configuration.ignoreShadowsSingleWindow = false
        }

        let selectedStream = SCStream(filter: filter, configuration: configuration, delegate: nil)
        try selectedStream.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)

        let selectedWriter = try AVAssetWriter(outputURL: URL(fileURLWithPath: outputPath), fileType: .mov)
        let selectedInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
        ])
        selectedInput.expectsMediaDataInRealTime = true
        guard selectedWriter.canAdd(selectedInput) else {
            throw BridgeError("screen-recording-writer-input-unavailable", "AVAssetWriter cannot accept the window recording input.")
        }
        selectedWriter.add(selectedInput)

        if stopped || Task.isCancelled {
            return
        }
        writer = selectedWriter
        input = selectedInput
        stream = selectedStream
        try await selectedStream.startCapture()
    }

    private func finishAsync() async throws {
        if let stream {
            do {
                try await stream.stopCapture()
            } catch {
                if !isAlreadyStoppedStreamError(error) {
                    throw error
                }
            }
        }
        try finishWriter()
    }

    private func finishWriter() throws {
        final class FinishBox: @unchecked Sendable {
            var error: Error?
        }
        let box = FinishBox()
        let semaphore = DispatchSemaphore(value: 0)
        queue.async {
            guard let writer = self.writer else {
                semaphore.signal()
                return
            }
            if writer.status == .writing {
                self.input?.markAsFinished()
                writer.finishWriting {
                    box.error = writer.error
                    semaphore.signal()
                }
            } else {
                box.error = writer.error
                semaphore.signal()
            }
        }
        if semaphore.wait(timeout: .now() + .seconds(8)) == .timedOut {
            throw BridgeError("screen-window-recording-writer-finish-timeout", "ScreenCaptureKit window recording writer finish timed out.")
        }
        if let error = box.error {
            throw error
        }
    }

    private func selectWindow(from windows: [SCWindow]) -> SCWindow? {
        let candidates = windows.filter { window in
            if let windowId = target.windowId, Int(window.windowID) != windowId {
                return false
            }
            if let processId = target.processId, Int(window.owningApplication?.processID ?? 0) != processId {
                return false
            }
            if let bundleIdentifier = target.bundleIdentifier, window.owningApplication?.bundleIdentifier != bundleIdentifier {
                return false
            }
            if let displayBounds = target.displayBounds, !isLikelyOverlayFrame(window.frame, inside: displayBounds) {
                return false
            }
            return true
        }
        return candidates.sorted { left, right in
            (left.frame.width * left.frame.height) > (right.frame.width * right.frame.height)
        }.first
    }

    private func isLikelyOverlayFrame(_ frame: CGRect, inside displayBounds: CGRect) -> Bool {
        let widthDelta = abs(frame.width - displayBounds.width)
        let heightDelta = abs(frame.height - displayBounds.height)
        let originXDelta = abs(frame.minX - displayBounds.minX)
        let originYDelta = abs(frame.minY - displayBounds.minY)
        let tolerance: CGFloat = 8
        return widthDelta <= tolerance
            && heightDelta <= tolerance
            && originXDelta <= tolerance
            && originYDelta <= tolerance
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard outputType == .screen,
              sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              attachments.first?[.status] as? SCFrameStatus == .complete,
              let writer,
              let input
        else {
            return
        }

        let sampleTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        if firstSampleTime == nil {
            firstSampleTime = sampleTime
            writer.startWriting()
            writer.startSession(atSourceTime: sampleTime)
        }
        guard writer.status == .writing, input.isReadyForMoreMediaData else {
            return
        }
        if input.append(sampleBuffer) {
            frameCount += 1
            lastSampleTime = sampleTime
        }
    }
}

private func readPositiveDouble(_ value: Any?) -> Double? {
    let number: Double?
    if let raw = value as? NSNumber {
        number = raw.doubleValue
    } else if let raw = value as? Double {
        number = raw
    } else {
        number = nil
    }
    guard let number, number > 0, number.isFinite else {
        return nil
    }
    return number
}

private func readOptionalDisplayId(_ params: [String: Any]) -> CGDirectDisplayID? {
    guard let raw = params["displayId"] else {
        return nil
    }
    if let number = raw as? NSNumber {
        return CGDirectDisplayID(number.uint32Value)
    }
    if let value = raw as? UInt32 {
        return CGDirectDisplayID(value)
    }
    if let value = raw as? Int, value >= 0 {
        return CGDirectDisplayID(value)
    }
    return nil
}

private func readOptionalPositiveInteger(_ raw: Any?) -> Int? {
    if let number = raw as? NSNumber {
        let value = number.intValue
        return value > 0 ? value : nil
    }
    if let value = raw as? Int, value > 0 {
        return value
    }
    return nil
}

private func readOptionalRect(_ raw: [String: Any]?) -> CGRect? {
    guard let raw,
          let x = readFiniteDouble(raw["x"]),
          let y = readFiniteDouble(raw["y"]),
          let width = readPositiveDouble(raw["width"]),
          let height = readPositiveDouble(raw["height"])
    else {
        return nil
    }
    return CGRect(x: x, y: y, width: width, height: height)
}

private func readCGRect(_ raw: Any?) -> CGRect? {
    guard let bounds = readBounds(raw),
          let x = bounds["x"],
          let y = bounds["y"],
          let width = bounds["width"],
          let height = bounds["height"],
          width > 0,
          height > 0
    else {
        return nil
    }
    return CGRect(x: x, y: y, width: width, height: height)
}

private func readOptionalPayloadValue(_ value: Any?) -> Any {
    value ?? NSNull()
}

private func readFiniteDouble(_ raw: Any?) -> Double? {
    let number: Double?
    if let raw = raw as? NSNumber {
        number = raw.doubleValue
    } else if let raw = raw as? Double {
        number = raw
    } else {
        number = nil
    }
    guard let number, number.isFinite else {
        return nil
    }
    return number
}

private func serializeRecordingError(_ error: Error) -> [String: Any] {
    if let bridgeError = error as? BridgeError {
        return [
            "code": bridgeError.code,
            "message": bridgeError.message,
            "details": bridgeError.details ?? NSNull(),
        ]
    }
    return [
        "code": "unknown-error",
        "message": "\(error)",
        "details": NSNull(),
    ]
}
