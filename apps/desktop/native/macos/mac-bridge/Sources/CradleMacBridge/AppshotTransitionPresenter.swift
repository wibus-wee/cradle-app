// Presents Cradle-owned Appshot capture transitions with AppKit and Core Animation.
import AppKit
import ImageIO
import QuartzCore
import UniformTypeIdentifiers

struct AppshotTransitionResult {
    let animationDuration: TimeInterval
    let transitionSnapshotPath: String?
    let transitionSnapshotHeight: Double?
    let transitionSnapshotImageSize: CaptureImageSize?
    let transitionSpringDampingFraction: Double?
    let transitionSpringResponse: Double?
    let transitionGeometry: [String: Any]

    func serialize() -> [String: Any] {
        [
            "strategy": "cradle-native",
            "animationDuration": animationDuration,
            "transitionSnapshotPath": transitionSnapshotPath ?? NSNull(),
            "transitionSnapshotHeight": transitionSnapshotHeight ?? NSNull(),
            "transitionSnapshotImageSize": transitionSnapshotImageSize?.serialize() ?? NSNull(),
            "transitionSpringDampingFraction": transitionSpringDampingFraction ?? NSNull(),
            "transitionSpringResponse": transitionSpringResponse ?? NSNull(),
            "transitionGeometry": transitionGeometry,
        ]
    }
}

struct AppshotTransitionCalibration {
    let animationDuration: TimeInterval
    let transitionSnapshotHeight: Double?
    let springResponse: Double
    let springDampingFraction: Double

    static func from(
        params: [String: Any],
        target: AppshotTransitionTarget,
        windowTitle: String? = nil,
        appName: String? = nil
    ) -> AppshotTransitionCalibration {
        let animationDuration = readPositiveDouble(params["animationDuration"]) ?? AppshotTransitionTiming.animationDuration
        let transitionSnapshotHeight = readPositiveDouble(params["transitionSnapshotHeight"]).map { $0 / Double(target.transitionSnapshotScale) }
            ?? AppshotLayerMetrics.transitionSnapshotBaseHeight
        let springResponse = readPositiveDouble(params["transitionSpringResponse"]) ?? AppshotTransitionTiming.placeholderSpringResponse
        let springDampingFraction = readPositiveDouble(params["transitionSpringDampingFraction"]) ?? AppshotTransitionTiming.placeholderSpringDampingFraction
        return AppshotTransitionCalibration(
            animationDuration: animationDuration,
            transitionSnapshotHeight: transitionSnapshotHeight,
            springResponse: springResponse,
            springDampingFraction: springDampingFraction
        )
    }
}

enum AppshotLayerMetrics {
    static let transitionBackgroundOpacity: Float = 0.0
    static let shutterOpacity: Float = 1.0
    static let overlayPadding: CGFloat = 96
    static let transitionSnapshotBaseWidth: CGFloat = 232
    static let transitionSnapshotBaseHeight: Double = 140
    static let shadowOpacity: Float = 0.3
    static let shadowCornerRadius: CGFloat = 12
    static let screenshotCornerRadius: CGFloat = 12
    static let shadowRadius: CGFloat = 20
    static let shadowYOffset: CGFloat = -10
    static let appIconSize: CGFloat = 24
    static let appIconBottomInset: CGFloat = 0
    static let titleHeight: CGFloat = 17
    static let titleTopMargin: CGFloat = 4
    static let titleHorizontalInset: CGFloat = 8
    static let titleFontSize: CGFloat = 13
}

enum AppshotTransitionTiming {
    static let animationDuration: TimeInterval = 0.88
    static let completionDelay: TimeInterval = 0
    static let placeholderSpringResponse = 0.35
    static let placeholderSpringDampingFraction = 0.73
    static let backgroundFadeIn: NSNumber = 0.06
    static let backgroundFadeOut: NSNumber = 0.82
    static let shutterFadeIn: NSNumber = 0.06
    static let shutterHold: NSNumber = 0.16
    static let readyForMagicMove: NSNumber = shutterHold
    static let readyForMagicMoveWait: TimeInterval = 1.0 / 90.0
    static let shutterFadeOutStart: NSNumber = 0.16
    static let shutterFadeOut: NSNumber = 1
    static let snapshotFadeIn: NSNumber = 0.82
    static let magicMoveFadeDuration: TimeInterval = 0.125
    static let shadowFadeIn: NSNumber = 0.32
    static let visualHandoffStartProgress: NSNumber = 0.92
    static let accessoryFadeStartProgress: NSNumber = 0.95
    static let accessoryFadeDuration: TimeInterval = 0.3
    static func magicMoveTimingFunction() -> CAMediaTimingFunction {
        CAMediaTimingFunction(controlPoints: 0.16, 0, 0.3, 1)
    }

    static func magicMoveFadeEndProgress(duration: TimeInterval) -> NSNumber {
        let total = max(duration, 0.001)
        let start = snapshotFadeIn.doubleValue
        return NSNumber(value: min(1, start + magicMoveFadeDuration / total))
    }
}

struct AppshotTransitionTarget {
    let coordinateSpace: String
    let sourceWindowFrame: CGRect
    let sourceContentFrame: CGRect
    let destinationFrame: CGRect
    let destinationBackgroundColor: NSColor
    let destinationPrimaryTextColor: NSColor
    let destinationCornerRadius: CGFloat
    let transitionSnapshotScale: CGFloat
    let displayFrame: CGRect
    let displayWorkArea: CGRect
    let displayScaleFactor: CGFloat
    let displayMapping: AppshotDisplayMapping

    static func from(
        params: [String: Any],
        fallbackWindowBounds: [String: Double]?,
        captureImageSize: CaptureImageSize? = nil
    ) -> AppshotTransitionTarget {
        let sourceFrames = readSourceFrames(windowBounds: fallbackWindowBounds, captureImageSize: captureImageSize)
        if let rawTarget = params["animationTarget"] as? [String: Any],
           let rawDestinationFrame = rawTarget["destinationFrame"] as? [String: Any],
           let rawDisplay = rawTarget["codexDisplay"] as? [String: Any] {
            let scaleFactor = (rawDisplay["scaleFactor"] as? NSNumber)?.doubleValue ?? Double(NSScreen.main?.backingScaleFactor ?? 2)
            let coordinateSpace = rawTarget["coordinateSpace"] as? String ?? "screenPoints"
            let geometryScale = AppshotTransitionTarget.geometryScale(
                coordinateSpace: coordinateSpace,
                scaleFactor: CGFloat(scaleFactor)
            )
            let transitionSnapshotScale = readPositiveDouble(rawTarget["transitionSnapshotScale"]) ?? scaleFactor
            let destinationFrame = readScaledRect(rawDestinationFrame, scale: geometryScale) ?? fallbackDestinationFrame(fallbackWindowBounds)
            let displayBounds = readScaledRect(rawDisplay["bounds"] as? [String: Any], scale: geometryScale) ?? fallbackDisplayFrame(containing: destinationFrame)
            let displayWorkArea = readScaledRect(rawDisplay["workArea"] as? [String: Any], scale: geometryScale) ?? displayBounds
            let displayId = (rawDisplay["id"] as? NSNumber)?.intValue
            return AppshotTransitionTarget(
                coordinateSpace: coordinateSpace,
                sourceWindowFrame: sourceFrames.captureFrame,
                sourceContentFrame: sourceFrames.contentFrame,
                destinationFrame: destinationFrame,
                destinationBackgroundColor: readColor(rawTarget["destinationBackgroundColor"] as? String) ?? NSColor.windowBackgroundColor,
                destinationPrimaryTextColor: readColor(rawTarget["destinationPrimaryTextColor"] as? String) ?? NSColor.labelColor,
                destinationCornerRadius: CGFloat((rawTarget["destinationCornerRadius"] as? NSNumber)?.doubleValue ?? 0),
                transitionSnapshotScale: CGFloat(transitionSnapshotScale),
                displayFrame: displayBounds,
                displayWorkArea: displayWorkArea,
                displayScaleFactor: CGFloat(scaleFactor),
                displayMapping: AppshotDisplayMapping.resolve(displayId: displayId, topLeftFrame: displayBounds)
            )
        }

        let destinationFrame = fallbackDestinationFrame(fallbackWindowBounds)
        let displayFrame = fallbackDisplayFrame(containing: destinationFrame)
        return AppshotTransitionTarget(
            coordinateSpace: "screenPoints",
            sourceWindowFrame: sourceFrames.captureFrame,
            sourceContentFrame: sourceFrames.contentFrame,
            destinationFrame: destinationFrame,
            destinationBackgroundColor: NSColor.windowBackgroundColor,
            destinationPrimaryTextColor: NSColor.labelColor,
            destinationCornerRadius: 0,
            transitionSnapshotScale: NSScreen.main?.backingScaleFactor ?? 2,
            displayFrame: displayFrame,
            displayWorkArea: displayFrame,
            displayScaleFactor: NSScreen.main?.backingScaleFactor ?? 2,
            displayMapping: AppshotDisplayMapping.resolve(displayId: nil, topLeftFrame: displayFrame)
        )
    }

    var appKitSourceWindowFrame: CGRect {
        appKitRect(fromTopLeftRect: sourceWindowFrame, mapping: sourceDisplayMapping)
    }

    var appKitSourceContentFrame: CGRect {
        appKitRect(fromTopLeftRect: sourceContentFrame, mapping: sourceDisplayMapping)
    }

    var appKitDestinationFrame: CGRect {
        appKitRect(fromTopLeftRect: destinationFrame, mapping: displayMapping)
    }

    func appKitDestinationFrame(height: CGFloat) -> CGRect {
        appKitRect(
            fromTopLeftRect: CGRect(
                x: destinationFrame.minX,
                y: destinationFrame.minY,
                width: destinationFrame.width,
                height: height
            ),
            mapping: displayMapping
        )
    }

    var sourceDisplayMapping: AppshotDisplayMapping {
        AppshotDisplayMapping.containing(topLeftRect: sourceWindowFrame) ?? displayMapping
    }

    var overlayFrame: CGRect {
        appKitSourceWindowFrame
            .union(appKitDestinationFrame)
            .insetBy(dx: -AppshotLayerMetrics.overlayPadding, dy: -AppshotLayerMetrics.overlayPadding)
    }

    var overlayPanelFrames: [CGRect] {
        let screenFrames = NSScreen.screens.map(\.frame)
        let frames = screenFrames.compactMap { screenFrame -> CGRect? in
            let frame = overlayFrame.intersection(screenFrame)
            return frame.isNull || frame.isEmpty ? nil : frame
        }
        return frames.isEmpty ? [overlayFrame] : frames
    }

    func serializeTransitionGeometry() -> [String: Any] {
        let capture = appKitSourceWindowFrame
        let source = appKitSourceContentFrame
        let destination = appKitDestinationFrame
        return [
            "coordinateSpace": coordinateSpace,
            "sourceWindowFrame": serializeAppshotRect(sourceWindowFrame),
            "sourceContentFrame": serializeAppshotRect(sourceContentFrame),
            "destinationFrame": serializeAppshotRect(destinationFrame),
            "displayFrame": serializeAppshotRect(displayFrame),
            "displayWorkArea": serializeAppshotRect(displayWorkArea),
            "displayMapping": displayMapping.serialize(),
            "sourceDisplayMapping": sourceDisplayMapping.serialize(),
            "appKitDisplayFrame": serializeAppshotRect(displayMapping.appKitFrame),
            "appKitSourceDisplayFrame": serializeAppshotRect(sourceDisplayMapping.appKitFrame),
            "overlayFrame": serializeAppshotRect(overlayFrame),
            "overlayPanelFrames": overlayPanelFrames.map(serializeAppshotRect),
            "appKitSourceWindowFrame": serializeAppshotRect(capture),
            "appKitSourceContentFrame": serializeAppshotRect(source),
            "appKitDestinationFrame": serializeAppshotRect(destination),
            "overlayStartFrame": serializeAppshotRect(CGRect(
                x: capture.minX - overlayFrame.minX,
                y: capture.minY - overlayFrame.minY,
                width: capture.width,
                height: capture.height
            )),
            "overlayCaptureFrame": serializeAppshotRect(CGRect(
                x: capture.minX - overlayFrame.minX,
                y: capture.minY - overlayFrame.minY,
                width: capture.width,
                height: capture.height
            )),
            "overlayDestinationFrame": serializeAppshotRect(CGRect(
                x: destination.minX - overlayFrame.minX,
                y: destination.minY - overlayFrame.minY,
                width: destination.width,
                height: destination.height
            )),
            "overlaySourceContentFrame": serializeAppshotRect(CGRect(
                x: source.minX - overlayFrame.minX,
                y: source.minY - overlayFrame.minY,
                width: source.width,
                height: source.height
            )),
        ]
    }

    private func appKitRect(fromTopLeftRect rect: CGRect, mapping: AppshotDisplayMapping) -> CGRect {
        CGRect(
            x: mapping.appKitFrame.minX + rect.minX - mapping.topLeftFrame.minX,
            y: mapping.appKitFrame.minY + mapping.topLeftFrame.maxY - rect.maxY,
            width: rect.width,
            height: rect.height
        )
    }

    private static func readRect(_ raw: [String: Any]?) -> CGRect? {
        guard let raw,
              let x = raw["x"] as? NSNumber,
              let y = raw["y"] as? NSNumber,
              let width = raw["width"] as? NSNumber,
              let height = raw["height"] as? NSNumber,
              width.doubleValue > 0,
              height.doubleValue > 0
        else {
            return nil
        }
        return CGRect(x: x.doubleValue, y: y.doubleValue, width: width.doubleValue, height: height.doubleValue)
    }

    private static func readScaledRect(_ raw: [String: Any]?, scale: CGFloat) -> CGRect? {
        guard let rect = readRect(raw) else {
            return nil
        }
        let divisor = max(scale, 1)
        return CGRect(
            x: rect.minX / divisor,
            y: rect.minY / divisor,
            width: rect.width / divisor,
            height: rect.height / divisor
        )
    }

    private static func geometryScale(coordinateSpace: String, scaleFactor: CGFloat) -> CGFloat {
        switch coordinateSpace {
        case "pixels", "viewportPixels":
            return max(scaleFactor, 1)
        default:
            return 1
        }
    }

    private static func fallbackDestinationFrame(_ bounds: [String: Double]?) -> CGRect {
        if let bounds,
           let x = bounds["x"],
           let y = bounds["y"],
           let width = bounds["width"],
           let height = bounds["height"],
           width > 0,
           height > 0 {
            return CGRect(x: x, y: y, width: width, height: height)
        }
        let screen = NSScreen.main ?? NSScreen.screens[0]
        let frame = screen.visibleFrame
        let width = min(frame.width * 0.48, 540)
        let height = min(frame.height * 0.34, 360)
        return CGRect(x: frame.midX - width / 2, y: frame.midY - height / 2, width: width, height: height)
    }

    private static func readSourceFrames(windowBounds: [String: Double]?, captureImageSize: CaptureImageSize?) -> (captureFrame: CGRect, contentFrame: CGRect) {
        let bounds = fallbackDestinationFrame(windowBounds)
        guard let captureImageSize else {
            return (captureFrame: bounds, contentFrame: bounds)
        }
        let scale = max(AppshotDisplayMapping.containing(topLeftRect: bounds)?.scaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2, 1)
        let captureSize = CGSize(
            width: CGFloat(captureImageSize.pixelWidth) / scale,
            height: CGFloat(captureImageSize.pixelHeight) / scale
        )
        guard abs(captureSize.width - bounds.width) > 1 || abs(captureSize.height - bounds.height) > 1 else {
            return (captureFrame: bounds, contentFrame: bounds)
        }
        let captureFrame = CGRect(
            x: bounds.midX - captureSize.width / 2,
            y: bounds.midY - captureSize.height / 2,
            width: captureSize.width,
            height: captureSize.height
        )
        return (captureFrame: captureFrame, contentFrame: bounds)
    }

    private static func fallbackDisplayFrame(containing rect: CGRect) -> CGRect {
        AppshotDisplayMapping.containing(topLeftRect: rect)?.topLeftFrame
            ?? AppshotDisplayMapping.resolve(displayId: nil, topLeftFrame: rect).topLeftFrame
    }

}

struct AppshotDisplayMapping {
    let displayId: Int?
    let topLeftFrame: CGRect
    let appKitFrame: CGRect
    let scaleFactor: CGFloat

    static func resolve(displayId: Int?, topLeftFrame: CGRect) -> AppshotDisplayMapping {
        let mappings = readMappings()
        if let displayId,
           let mapping = mappings.first(where: { $0.displayId == displayId }) {
            return mapping
        }
        if let mapping = mappings.first(where: { rectsApproximatelyEqual($0.topLeftFrame, topLeftFrame) }) {
            return mapping
        }
        if let mapping = mappings.first(where: { $0.topLeftFrame.intersects(topLeftFrame) || topLeftFrame.intersects($0.topLeftFrame) }) {
            return mapping
        }
        if let mapping = mappings.first(where: { sizesApproximatelyEqual($0.topLeftFrame.size, topLeftFrame.size) }) {
            return mapping
        }
        let screen = NSScreen.main ?? NSScreen.screens[0]
        return AppshotDisplayMapping(
            displayId: readScreenDisplayId(screen),
            topLeftFrame: topLeftFrame,
            appKitFrame: screen.frame,
            scaleFactor: screen.backingScaleFactor
        )
    }

    static func containing(topLeftRect rect: CGRect) -> AppshotDisplayMapping? {
        let point = CGPoint(x: rect.midX, y: rect.midY)
        let mappings = readMappings()
        return mappings.first(where: { $0.topLeftFrame.contains(point) })
            ?? mappings.first(where: { $0.topLeftFrame.intersects(rect) })
    }

    static func readMappings() -> [AppshotDisplayMapping] {
        NSScreen.screens.map { screen in
            let displayId = readScreenDisplayId(screen)
            let topLeftFrame = displayId
                .map { CGRect(origin: CGDisplayBounds(CGDirectDisplayID($0)).origin, size: CGDisplayBounds(CGDirectDisplayID($0)).size) }
                .flatMap { $0.isNull || $0.isEmpty ? nil : $0 }
                ?? screen.frame
            return AppshotDisplayMapping(
                displayId: displayId,
                topLeftFrame: topLeftFrame,
                appKitFrame: screen.frame,
                scaleFactor: screen.backingScaleFactor
            )
        }
    }

    func serialize() -> [String: Any] {
        [
            "displayId": displayId ?? NSNull(),
            "topLeftFrame": serializeAppshotRect(topLeftFrame),
            "appKitFrame": serializeAppshotRect(appKitFrame),
            "scaleFactor": Double(scaleFactor),
        ]
    }

    private static func rectsApproximatelyEqual(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
        abs(lhs.minX - rhs.minX) < 1
            && abs(lhs.minY - rhs.minY) < 1
            && abs(lhs.width - rhs.width) < 1
            && abs(lhs.height - rhs.height) < 1
    }

    private static func sizesApproximatelyEqual(_ lhs: CGSize, _ rhs: CGSize) -> Bool {
        abs(lhs.width - rhs.width) < 1 && abs(lhs.height - rhs.height) < 1
    }

    private static func readScreenDisplayId(_ screen: NSScreen) -> Int? {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue
    }
}

final class AppshotTransitionPresenter: @unchecked Sendable {
    private var activeSounds: [NSSound] = []

    func present(
        screenshotPath: String,
        transitionSnapshotPath: String?,
        transitionSnapshotImageSize: CaptureImageSize?,
        sourceWindow: WindowCandidate?,
        target: AppshotTransitionTarget,
        calibration: AppshotTransitionCalibration,
        appTitle: String?,
        bundleIdentifier: String?,
        soundEnabled: Bool
    ) -> AppshotTransitionResult {
        Task { @MainActor in
            self.presentOnMain(
                screenshotPath: screenshotPath,
                transitionSnapshotPath: transitionSnapshotPath,
                sourceWindow: sourceWindow,
                target: target,
                calibration: calibration,
                appTitle: appTitle,
                bundleIdentifier: bundleIdentifier,
                soundEnabled: soundEnabled
            )
        }

        return AppshotTransitionResult(
            animationDuration: calibration.animationDuration,
            transitionSnapshotPath: transitionSnapshotPath,
            transitionSnapshotHeight: calibration.transitionSnapshotHeight,
            transitionSnapshotImageSize: transitionSnapshotImageSize,
            transitionSpringDampingFraction: calibration.springDampingFraction,
            transitionSpringResponse: calibration.springResponse,
            transitionGeometry: target.serializeTransitionGeometry()
        )
    }

    @MainActor
    private func presentOnMain(
        screenshotPath: String,
        transitionSnapshotPath: String?,
        sourceWindow: WindowCandidate?,
        target: AppshotTransitionTarget,
        calibration: AppshotTransitionCalibration,
        appTitle: String?,
        bundleIdentifier: String?,
        soundEnabled: Bool
    ) {
        let application = NSApplication.shared
        if application.activationPolicy() == .regular {
            application.setActivationPolicy(.accessory)
        }

        let transitionController = makeTransitionController(
            sourceWindow: sourceWindow,
            target: target,
            appTitle: appTitle,
            bundleIdentifier: bundleIdentifier
        )
        let panels = target.overlayPanelFrames.map { panelFrame in
            let panel = AppshotTransitionOverlayWindow(
                frame: panelFrame,
                screenshotPath: screenshotPath,
                transitionSnapshotPath: transitionSnapshotPath,
                transitionController: transitionController,
                target: target,
                transitionSnapshotHeight: calibration.transitionSnapshotHeight,
                appTitle: appTitle,
                bundleIdentifier: bundleIdentifier
            )
            panel.setFrame(panelFrame, display: true)
            panel.orderFrontRegardless()
            panel.layoutTransitionIfNeeded()
            return panel
        }
        transitionController.attach(overlayWindows: panels)
        logTransitionPresentation(panels: panels, target: target)
        if soundEnabled {
            playAppshotSound()
        }
        for panel in panels {
            panel.play(duration: calibration.animationDuration) {
                Task { @MainActor in
                    panel.orderOut(nil)
                }
            }
        }
    }

    @MainActor
    private func playAppshotSound() {
        guard let soundURL = readAppshotSoundURL(),
              let sound = NSSound(contentsOf: soundURL, byReference: false)
        else {
            NSSound(named: NSSound.Name("Tink"))?.play()
            return
        }
        activeSounds.append(sound)
        sound.play()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self, weak sound] in
            guard let sound else { return }
            self?.activeSounds.removeAll { $0 === sound }
        }
    }

    private func readAppshotSoundURL() -> URL? {
        let executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        let resourceURL = executableURL
            .deletingLastPathComponent()
            .appendingPathComponent("resources")
            .appendingPathComponent("Appshot.wav")
        if FileManager.default.fileExists(atPath: resourceURL.path) {
            return resourceURL
        }
        return nil
    }

    @MainActor
    private func logTransitionPresentation(panels: [NSWindow], target: AppshotTransitionTarget) {
        guard let data = try? JSONSerialization.data(withJSONObject: [
            "panels": panels.map { panel in
                [
                    "panelWindowNumber": panel.windowNumber,
                    "panelFrame": serializeAppshotRect(panel.frame),
                    "panelLevel": panel.level.rawValue,
                    "isVisible": panel.isVisible,
                ]
            },
            "displayMappings": AppshotDisplayMapping.readMappings().map { $0.serialize() },
            "geometry": target.serializeTransitionGeometry(),
        ], options: [.sortedKeys]),
            let payload = String(data: data, encoding: .utf8)
        else {
            return
        }
        FileHandle.standardError.write(Data("[appshot-transition] \(payload)\n".utf8))
    }

    @MainActor
    private func makeTransitionController(
        sourceWindow: WindowCandidate?,
        target: AppshotTransitionTarget,
        appTitle: String?,
        bundleIdentifier: String?
    ) -> AppshotCaptureTransition {
        AppshotCaptureTransition(
            sourceWindow: sourceWindow,
            sourceFrame: target.appKitSourceContentFrame,
            targetFrame: target.appKitDestinationFrame,
            targetCornerRadius: max(target.destinationCornerRadius, 0),
            appIcon: readApplicationIconImage(bundleIdentifier: bundleIdentifier),
            titleText: appTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
            titleColor: target.destinationPrimaryTextColor,
            destinationBackgroundColor: target.destinationBackgroundColor
        )
    }

    func probeVisibility(
        screenshotPath: String,
        outputDir: String,
        target: AppshotTransitionTarget,
        calibration: AppshotTransitionCalibration,
        appTitle: String?,
        bundleIdentifier: String?,
        sampleCount: Int,
        sampleIntervalSeconds: TimeInterval,
        captureImages: Bool
    ) throws -> [String: Any] {
        final class ProbeBox: @unchecked Sendable {
            var result: [String: Any]?
            var error: Error?
        }

        let box = ProbeBox()
        let semaphore = DispatchSemaphore(value: 0)
        Task { @MainActor in
            do {
                box.result = try await self.probeVisibilityOnMain(
                    screenshotPath: screenshotPath,
                    outputDir: outputDir,
                    target: target,
                    calibration: calibration,
                    appTitle: appTitle,
                    bundleIdentifier: bundleIdentifier,
                    sampleCount: sampleCount,
                    sampleIntervalSeconds: sampleIntervalSeconds,
                    captureImages: captureImages
                )
            } catch {
                box.error = error
            }
            semaphore.signal()
        }

        let timeoutSeconds = max(Int(ceil(Double(sampleCount) * sampleIntervalSeconds + calibration.animationDuration + 8)), 12)
        if semaphore.wait(timeout: .now() + .seconds(timeoutSeconds)) == .timedOut {
            throw BridgeError("appshot-visibility-probe-timeout", "Appshot transition visibility probe timed out.", details: [
                "timeoutSeconds": String(timeoutSeconds),
            ])
        }
        if let error = box.error {
            throw error
        }
        guard let result = box.result else {
            throw BridgeError("appshot-visibility-probe-empty-result", "Appshot transition visibility probe did not produce a result.")
        }
        return result
    }

    func probePresentation(
        screenshotPath: String,
        transitionSnapshotPath: String?,
        outputDir: String,
        target: AppshotTransitionTarget,
        calibration: AppshotTransitionCalibration,
        appTitle: String?,
        bundleIdentifier: String?,
        sampleCount: Int,
        sampleIntervalSeconds: TimeInterval,
        renderImages: Bool
    ) throws -> [String: Any] {
        final class ProbeBox: @unchecked Sendable {
            var result: [String: Any]?
            var error: Error?
        }

        let box = ProbeBox()
        let semaphore = DispatchSemaphore(value: 0)
        Task { @MainActor in
            do {
                box.result = try await self.probePresentationOnMain(
                    screenshotPath: screenshotPath,
                    transitionSnapshotPath: transitionSnapshotPath,
                    outputDir: outputDir,
                    target: target,
                    calibration: calibration,
                    appTitle: appTitle,
                    bundleIdentifier: bundleIdentifier,
                    sampleCount: sampleCount,
                    sampleIntervalSeconds: sampleIntervalSeconds,
                    renderImages: renderImages
                )
            } catch {
                box.error = error
            }
            semaphore.signal()
        }

        let timeoutSeconds = max(Int(ceil(Double(sampleCount) * sampleIntervalSeconds + calibration.animationDuration + 8)), 12)
        if semaphore.wait(timeout: .now() + .seconds(timeoutSeconds)) == .timedOut {
            throw BridgeError("appshot-presentation-probe-timeout", "Appshot transition presentation probe timed out.", details: [
                "timeoutSeconds": String(timeoutSeconds),
            ])
        }
        if let error = box.error {
            throw error
        }
        guard let result = box.result else {
            throw BridgeError("appshot-presentation-probe-empty-result", "Appshot transition presentation probe did not produce a result.")
        }
        return result
    }

    @MainActor
    private func probeVisibilityOnMain(
        screenshotPath: String,
        outputDir: String,
        target: AppshotTransitionTarget,
        calibration: AppshotTransitionCalibration,
        appTitle: String?,
        bundleIdentifier: String?,
        sampleCount: Int,
        sampleIntervalSeconds: TimeInterval,
        captureImages: Bool
    ) async throws -> [String: Any] {
        try FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

        let transitionController = makeTransitionController(
            sourceWindow: nil,
            target: target,
            appTitle: appTitle,
            bundleIdentifier: bundleIdentifier
        )
        let panel = AppshotTransitionOverlayWindow(
            frame: target.overlayFrame,
            screenshotPath: screenshotPath,
            transitionSnapshotPath: nil,
            transitionController: transitionController,
            target: target,
            transitionSnapshotHeight: calibration.transitionSnapshotHeight,
            appTitle: appTitle,
            bundleIdentifier: bundleIdentifier
        )
        transitionController.attach(overlayWindows: [panel])
        panel.orderFrontRegardless()
        panel.layoutTransitionIfNeeded()

        panel.play(duration: calibration.animationDuration) {}

        let panelWindowNumber = panel.windowNumber
        var samples: [[String: Any]] = []
        var imageCaptureEnabled = captureImages
        samples.append(try await readVisibilityProbeSample(
            outputDir: outputDir,
            index: 0,
            target: target,
            panelWindowNumber: panelWindowNumber,
            imageCaptureEnabled: imageCaptureEnabled,
            imageCaptureTimeoutSeconds: 0.18
        ).value)
        if samples.last?["imageStatus"] as? String == "timeout" {
            imageCaptureEnabled = false
        }

        for index in 1...max(sampleCount, 1) {
            try await Task.sleep(nanoseconds: UInt64(max(sampleIntervalSeconds, 0.05) * 1_000_000_000))
            samples.append(try await readVisibilityProbeSample(
                outputDir: outputDir,
                index: index,
                target: target,
                panelWindowNumber: panelWindowNumber,
                imageCaptureEnabled: imageCaptureEnabled,
                imageCaptureTimeoutSeconds: 0.18
            ).value)
            if samples.last?["imageStatus"] as? String == "timeout" {
                imageCaptureEnabled = false
            }
        }

        panel.orderOut(nil)
        return [
            "panelWindowNumber": panelWindowNumber,
            "sampleCount": samples.count,
            "sampleIntervalSeconds": sampleIntervalSeconds,
            "animationDuration": calibration.animationDuration,
            "transitionGeometry": target.serializeTransitionGeometry(),
            "samples": samples,
        ]
    }

    @MainActor
    private func probePresentationOnMain(
        screenshotPath: String,
        transitionSnapshotPath: String?,
        outputDir: String,
        target: AppshotTransitionTarget,
        calibration: AppshotTransitionCalibration,
        appTitle: String?,
        bundleIdentifier: String?,
        sampleCount: Int,
        sampleIntervalSeconds: TimeInterval,
        renderImages: Bool
    ) async throws -> [String: Any] {
        try FileManager.default.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

        let transitionController = makeTransitionController(
            sourceWindow: nil,
            target: target,
            appTitle: appTitle,
            bundleIdentifier: bundleIdentifier
        )
        let panel = AppshotTransitionOverlayWindow(
            frame: target.overlayFrame,
            screenshotPath: screenshotPath,
            transitionSnapshotPath: transitionSnapshotPath,
            transitionController: transitionController,
            target: target,
            transitionSnapshotHeight: calibration.transitionSnapshotHeight,
            appTitle: appTitle,
            bundleIdentifier: bundleIdentifier
        )
        transitionController.attach(overlayWindows: [panel])
        panel.orderFrontRegardless()
        panel.layoutTransitionIfNeeded()

        panel.play(duration: calibration.animationDuration) {}

        var samples: [[String: Any]] = []
        let startedAt = CFAbsoluteTimeGetCurrent()
        for index in 0..<max(sampleCount, 1) {
            if index > 0 {
                try await Task.sleep(nanoseconds: UInt64(max(sampleIntervalSeconds, 0.01) * 1_000_000_000))
            }
            samples.append(try panel.readPresentationProbeSample(
                outputDir: outputDir,
                index: index,
                startedAt: startedAt,
                renderImage: renderImages
            ))
        }

        panel.orderOut(nil)
        return [
            "panelWindowNumber": panel.windowNumber,
            "sampleCount": samples.count,
            "sampleIntervalSeconds": sampleIntervalSeconds,
            "animationDuration": calibration.animationDuration,
            "transitionGeometry": target.serializeTransitionGeometry(),
            "samples": samples,
        ]
    }

    private func readVisibilityProbeSample(
        outputDir: String,
        index: Int,
        target: AppshotTransitionTarget,
        panelWindowNumber: Int,
        imageCaptureEnabled: Bool,
        imageCaptureTimeoutSeconds: Double
    ) async throws -> ProbeSamplePayload {
        let startedAt = Date()
        return try await Task.detached(priority: .userInitiated) {
            do {
                return ProbeSamplePayload(value: try readVisibilityProbeSampleSync(
                    outputDir: outputDir,
                    index: index,
                    target: target,
                    panelWindowNumber: panelWindowNumber,
                    imageCaptureEnabled: imageCaptureEnabled
                ))
            } catch {
                let elapsedSeconds = Date().timeIntervalSince(startedAt)
                if elapsedSeconds >= imageCaptureTimeoutSeconds {
                    return ProbeSamplePayload(value: readVisibilityProbeTimeoutSample(
                        outputDir: outputDir,
                        index: index,
                        target: target,
                        panelWindowNumber: panelWindowNumber
                    ))
                }
                throw error
            }
        }.value
    }
}

private struct ProbeSamplePayload: @unchecked Sendable {
    let value: [String: Any]
}

private func serializeAppshotRect(_ rect: CGRect) -> [String: Double] {
    [
        "x": Double(rect.origin.x),
        "y": Double(rect.origin.y),
        "width": Double(rect.size.width),
        "height": Double(rect.size.height),
    ]
}

private func readVisibilityProbeSampleSync(
    outputDir: String,
    index: Int,
    target: AppshotTransitionTarget,
    panelWindowNumber: Int,
    imageCaptureEnabled: Bool
) throws -> [String: Any] {
        let rawWindows = (try? readRawWindowInventory()) ?? []
        let matchingWindow = rawWindows.first { raw in
            readInteger(raw[kCGWindowNumber as String]) == panelWindowNumber
        }
        let imagePath = (outputDir as NSString).appendingPathComponent("appshot-visibility-sample-\(String(format: "%03d", index)).png")
        var imageStatus = "skipped-after-timeout"
        if imageCaptureEnabled {
            imageStatus = "missing"
            if let image = CGWindowListCreateImage(
                target.overlayFrame,
                .optionOnScreenOnly,
                kCGNullWindowID,
                [.bestResolution]
            ) {
                try writeProbePNGImage(image, filePath: imagePath)
                imageStatus = "written"
            }
        }

        return [
            "index": index,
            "capturedAt": isoTimestamp(),
            "panelWindowNumber": panelWindowNumber,
            "panelFoundInCoreGraphicsWindowList": matchingWindow != nil,
            "windowCount": rawWindows.count,
            "panelWindow": matchingWindow.map(serializeRawWindowForProbe) ?? NSNull(),
            "imagePath": imageStatus == "written" ? imagePath : NSNull(),
            "imageStatus": imageStatus,
        ]
}

private func readVisibilityProbeTimeoutSample(
    outputDir: String,
    index: Int,
    target: AppshotTransitionTarget,
    panelWindowNumber: Int
) -> [String: Any] {
    let rawWindows = (try? readRawWindowInventory()) ?? []
    let matchingWindow = rawWindows.first { raw in
        readInteger(raw[kCGWindowNumber as String]) == panelWindowNumber
    }
    let imagePath = (outputDir as NSString).appendingPathComponent("appshot-visibility-sample-\(String(format: "%03d", index)).png")
    return [
        "index": index,
        "capturedAt": isoTimestamp(),
        "panelWindowNumber": panelWindowNumber,
        "panelFoundInCoreGraphicsWindowList": matchingWindow != nil,
        "windowCount": rawWindows.count,
        "panelWindow": matchingWindow.map(serializeRawWindowForProbe) ?? NSNull(),
        "imagePath": NSNull(),
        "imageStatus": "timeout",
        "timedOutImagePath": imagePath,
        "sampleTimeoutSeconds": 0.18,
        "captureRect": serialize(rect: target.overlayFrame),
    ]
}

private func serializeRawWindowForProbe(_ raw: [String: Any]) -> [String: Any] {
    [
        "windowId": readInteger(raw[kCGWindowNumber as String]) ?? NSNull(),
        "ownerPid": readInteger(raw[kCGWindowOwnerPID as String]) ?? NSNull(),
        "ownerName": raw[kCGWindowOwnerName as String] as? String ?? NSNull(),
        "title": raw[kCGWindowName as String] as? String ?? NSNull(),
        "layer": readInteger(raw[kCGWindowLayer as String]) ?? NSNull(),
        "alpha": (raw[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? NSNull(),
        "bounds": readBounds(raw[kCGWindowBounds as String]) ?? NSNull(),
    ]
}

private func writeProbePNGImage(_ image: CGImage, filePath: String) throws {
    let url = URL(fileURLWithPath: filePath)
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        throw BridgeError("png-destination-unavailable", "Could not create PNG destination for Appshot visibility probe image.")
    }
    CGImageDestinationAddImage(destination, image, nil)
    if !CGImageDestinationFinalize(destination) {
        throw BridgeError("png-write-failed", "Could not write Appshot visibility probe image as PNG.")
    }
}

private struct AppshotTransitionLayerRefs {
    let contentLayer: AppshotNonanimatedLayer
    let transitionBackgroundLayer: AppshotNonanimatedGradientLayer
    let shadowLayer: AppshotNonanimatedLayer
    let containerLayer: AppshotNonanimatedLayer
    let shutterLayer: AppshotNonanimatedLayer
    let snapshotEffectsLayer: AppshotNonanimatedLayer
    let snapshotImageLayer: AppshotNonanimatedLayer
    let snapshotMaskLayer: CAShapeLayer
    let snapshotMaskDebugLayer: CAShapeLayer
    let appIconLayer: AppshotNonanimatedLayer
    let titleLayer: AppshotNonanimatedTextLayer
}

private enum AppshotCaptureTransitionState: String {
    case idle
    case shutter
    case readyForMagicMove
    case magicMove
    case finished
    case closing
    case closed
}

final class AppshotCaptureTransition: @unchecked Sendable {
    let sourceWindow: WindowCandidate?
    let sourceFrame: CGRect
    let targetFrame: CGRect
    let targetCornerRadius: CGFloat
    let appIcon: NSImage?
    let titleText: String
    let titleColor: NSColor
    let destinationBackgroundColor: NSColor
    private(set) var overlayWindows: [AppshotTransitionOverlayWindow] = []
    private var state: AppshotCaptureTransitionState = .idle
    private(set) var completionRequested = false
    private var magicMoveWaiters: [@MainActor @Sendable () -> Void] = []

    init(
        sourceWindow: WindowCandidate?,
        sourceFrame: CGRect,
        targetFrame: CGRect,
        targetCornerRadius: CGFloat,
        appIcon: NSImage?,
        titleText: String,
        titleColor: NSColor,
        destinationBackgroundColor: NSColor
    ) {
        self.sourceWindow = sourceWindow
        self.sourceFrame = sourceFrame
        self.targetFrame = targetFrame
        self.targetCornerRadius = targetCornerRadius
        self.appIcon = appIcon
        self.titleText = titleText
        self.titleColor = titleColor
        self.destinationBackgroundColor = destinationBackgroundColor
    }

    @MainActor
    func attach(overlayWindows: [AppshotTransitionOverlayWindow]) {
        self.overlayWindows = overlayWindows
    }

    @MainActor
    fileprivate func updateState(_ state: AppshotCaptureTransitionState) {
        self.state = state
        if state == .magicMove {
            let waiters = magicMoveWaiters
            magicMoveWaiters = []
            for waiter in waiters {
                waiter()
            }
        }
    }

    @MainActor
    func waitForMagicMove(_ waiter: @escaping @MainActor @Sendable () -> Void) {
        if state == .magicMove || state == .finished {
            waiter()
            return
        }
        magicMoveWaiters.append(waiter)
    }

    @MainActor
    func requestCompletion() {
        completionRequested = true
    }

    @MainActor
    func serializeForProbe() -> [String: Any] {
        [
            "className": String(describing: type(of: self)),
            "sourceWindow": sourceWindow.map { window -> [String: Any] in
                [
                    "windowId": window.windowId,
                    "processId": window.processId,
                    "bundleId": window.bundleId ?? NSNull(),
                    "title": window.title ?? NSNull(),
                ]
            } ?? NSNull(),
            "sourceFrame": serialize(rect: sourceFrame),
            "targetFrame": serialize(rect: targetFrame),
            "targetCornerRadius": Double(targetCornerRadius),
            "appIconAvailable": appIcon != nil,
            "titleText": titleText,
            "titleColor": serializeCGColorForProbe(titleColor.cgColor),
            "destinationBackgroundColor": serializeCGColorForProbe(destinationBackgroundColor.cgColor),
            "overlayWindowCount": overlayWindows.count,
            "state": state.rawValue,
            "completionRequested": completionRequested,
            "magicMoveWaiterCount": magicMoveWaiters.count,
        ]
    }
}

final class AppshotTransitionOverlayWindow: NSWindow {
    private let transitionController: AppshotCaptureTransition
    private let transitionView: AppshotTransitionView
    private let sourceFrame: CGRect
    private let targetFrame: CGRect
    private let targetCornerRadius: CGFloat
    private let contentLayer: AppshotNonanimatedLayer
    private let transitionBackgroundLayer: AppshotNonanimatedGradientLayer
    private let shadowLayer: AppshotNonanimatedLayer
    private let containerLayer: AppshotNonanimatedLayer
    private let shutterLayer: AppshotNonanimatedLayer
    private let snapshotEffectsLayer: AppshotNonanimatedLayer
    private let snapshotImageLayer: AppshotNonanimatedLayer
    private let snapshotMaskLayer: CAShapeLayer
    private let snapshotMaskDebugLayer: CAShapeLayer
    private let appIconLayer: AppshotNonanimatedLayer
    private let titleLayer: AppshotNonanimatedTextLayer
    private let initialCornerRadius: CGFloat
    private let accessoryFadeStartProgress: CGFloat
    private let accessoryFadeDuration: TimeInterval
    private var snapshotImageSize = CGSize.zero
    private let titleText: String
    private var progress: CGFloat = 0
    private var accessoryFadeStarted = false

    fileprivate init(
        frame: CGRect,
        screenshotPath: String,
        transitionSnapshotPath: String?,
        transitionController: AppshotCaptureTransition,
        target: AppshotTransitionTarget,
        transitionSnapshotHeight: Double?,
        appTitle: String?,
        bundleIdentifier: String?
    ) {
        let contentLayer = AppshotNonanimatedLayer()
        let transitionBackgroundLayer = AppshotNonanimatedGradientLayer()
        let shadowLayer = AppshotNonanimatedLayer()
        let containerLayer = AppshotNonanimatedLayer()
        let shutterLayer = AppshotNonanimatedLayer()
        let snapshotEffectsLayer = AppshotNonanimatedLayer()
        let snapshotImageLayer = AppshotNonanimatedLayer()
        let snapshotMaskLayer = CAShapeLayer()
        let snapshotMaskDebugLayer = CAShapeLayer()
        let appIconLayer = AppshotNonanimatedLayer()
        let titleLayer = AppshotNonanimatedTextLayer()
        self.transitionController = transitionController
        sourceFrame = AppshotTransitionOverlayWindow.readSourceFrame(target: target, viewportFrame: frame)
        targetFrame = AppshotTransitionOverlayWindow.readTargetFrame(target: target, viewportFrame: frame)
        targetCornerRadius = max(target.destinationCornerRadius, 0)
        self.contentLayer = contentLayer
        self.transitionBackgroundLayer = transitionBackgroundLayer
        self.shadowLayer = shadowLayer
        self.containerLayer = containerLayer
        self.shutterLayer = shutterLayer
        self.snapshotEffectsLayer = snapshotEffectsLayer
        self.snapshotImageLayer = snapshotImageLayer
        self.snapshotMaskLayer = snapshotMaskLayer
        self.snapshotMaskDebugLayer = snapshotMaskDebugLayer
        self.appIconLayer = appIconLayer
        self.titleLayer = titleLayer
        initialCornerRadius = AppshotLayerMetrics.screenshotCornerRadius
        accessoryFadeStartProgress = CGFloat(AppshotTransitionTiming.accessoryFadeStartProgress.doubleValue)
        accessoryFadeDuration = AppshotTransitionTiming.accessoryFadeDuration
        titleText = appTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        transitionView = AppshotTransitionView(
            screenshotPath: screenshotPath,
            transitionSnapshotPath: transitionSnapshotPath,
            transitionController: transitionController,
            target: target,
            viewportFrame: frame,
            transitionSnapshotHeight: transitionSnapshotHeight,
            appTitle: appTitle,
            bundleIdentifier: bundleIdentifier,
            layers: AppshotTransitionLayerRefs(
                contentLayer: contentLayer,
                transitionBackgroundLayer: transitionBackgroundLayer,
                shadowLayer: shadowLayer,
                containerLayer: containerLayer,
                shutterLayer: shutterLayer,
                snapshotEffectsLayer: snapshotEffectsLayer,
                snapshotImageLayer: snapshotImageLayer,
                snapshotMaskLayer: snapshotMaskLayer,
                snapshotMaskDebugLayer: snapshotMaskDebugLayer,
                appIconLayer: appIconLayer,
                titleLayer: titleLayer
            )
        )
        super.init(
            contentRect: frame,
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        level = .screenSaver
        ignoresMouseEvents = true
        hidesOnDeactivate = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        contentView = transitionView
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    func layoutTransitionIfNeeded() {
        transitionView.layoutSubtreeIfNeeded()
    }

    func play(duration: TimeInterval, completion: @escaping @Sendable () -> Void) {
        transitionView.play(duration: duration, completion: completion)
    }

    func updateProgress(_ progress: CGFloat, accessoryFadeStarted: Bool) {
        self.progress = max(0, min(progress, 1))
        self.accessoryFadeStarted = accessoryFadeStarted
    }

    func updateSnapshotImageSize(_ snapshotImageSize: CGSize) {
        self.snapshotImageSize = snapshotImageSize
    }

    func readPresentationProbeSample(
        outputDir: String,
        index: Int,
        startedAt: CFAbsoluteTime,
        renderImage: Bool
    ) throws -> [String: Any] {
        var sample = try transitionView.readPresentationProbeSample(
            outputDir: outputDir,
            index: index,
            startedAt: startedAt,
            renderImage: renderImage
        )
        sample["overlayWindowClass"] = String(describing: type(of: self))
        sample["transitionControllerClass"] = String(describing: type(of: transitionController))
        sample["transitionControllerOwner"] = "AppshotCaptureTransition"
        sample["transitionLayerHost"] = "overlayWindow"
        sample["transitionController"] = transitionController.serializeForProbe()
        sample["hostViewClass"] = String(describing: type(of: transitionView))
        sample["overlayProgress"] = Double(progress)
        sample["overlayAccessoryFadeStarted"] = accessoryFadeStarted
        sample["progressHostedByOverlayWindow"] = true
        sample["overlaySourceFrame"] = serialize(rect: sourceFrame)
        sample["overlayTargetFrame"] = serialize(rect: targetFrame)
        sample["overlayTargetCornerRadius"] = Double(targetCornerRadius)
        sample["overlayInitialCornerRadius"] = Double(initialCornerRadius)
        sample["overlayAccessoryFadeStartProgress"] = Double(accessoryFadeStartProgress)
        sample["overlayAccessoryFadeDuration"] = accessoryFadeDuration
        sample["overlaySnapshotImageSize"] = serialize(rect: CGRect(origin: .zero, size: snapshotImageSize))
        sample["overlayTitleText"] = titleText
        return sample
    }

    private static func readSourceFrame(target: AppshotTransitionTarget, viewportFrame: CGRect) -> CGRect {
        let source = target.appKitSourceContentFrame
        return CGRect(
            x: source.minX - viewportFrame.minX,
            y: source.minY - viewportFrame.minY,
            width: source.width,
            height: source.height
        )
    }

    private static func readTargetFrame(target: AppshotTransitionTarget, viewportFrame: CGRect) -> CGRect {
        let destination = target.appKitDestinationFrame
        return CGRect(
            x: destination.minX - viewportFrame.minX,
            y: destination.minY - viewportFrame.minY,
            width: destination.width,
            height: destination.height
        )
    }
}

private final class AppshotNoImplicitAction: NSObject, CAAction, @unchecked Sendable {
    static let shared = AppshotNoImplicitAction()

    func run(forKey event: String, object anObject: Any, arguments dict: [AnyHashable: Any]?) {}
}

private final class AppshotNonanimatedLayer: CALayer {
    override func action(forKey event: String) -> CAAction? {
        AppshotNoImplicitAction.shared
    }
}

private final class AppshotNonanimatedTextLayer: CATextLayer {
    override func action(forKey event: String) -> CAAction? {
        AppshotNoImplicitAction.shared
    }
}

private final class AppshotNonanimatedGradientLayer: CAGradientLayer {
    override func action(forKey event: String) -> CAAction? {
        AppshotNoImplicitAction.shared
    }
}

enum AppshotVerticalAlignment {
    case center
    case bottom
}

final class AppshotTransitionView: NSView {
    private weak var overlayWindow: AppshotTransitionOverlayWindow?
    private let transitionController: AppshotCaptureTransition
    private let target: AppshotTransitionTarget
    private let viewportFrame: CGRect
    private let transitionSnapshotHeight: CGFloat?
    private let appTitle: String?
    private let bundleIdentifier: String?
    private let snapshotImageSource: String
    private let contentLayer: AppshotNonanimatedLayer
    private let transitionBackgroundLayer: AppshotNonanimatedGradientLayer
    private let shadowLayer: AppshotNonanimatedLayer
    private let containerLayer: AppshotNonanimatedLayer
    private let shutterLayer: AppshotNonanimatedLayer
    private let snapshotEffectsLayer: AppshotNonanimatedLayer
    private let snapshotImageLayer: AppshotNonanimatedLayer
    private let snapshotMaskLayer: CAShapeLayer
    private let snapshotMaskDebugLayer: CAShapeLayer
    private let appIconLayer: AppshotNonanimatedLayer
    private let titleLayer: AppshotNonanimatedTextLayer
    private var snapshotImageSize = CGSize.zero
    private var didStartTransition = false
    private var activeAnimationDuration = AppshotTransitionTiming.animationDuration
    private var activeTransitionPhase = "idle"
    private var activeTransitionPhaseHistory: [String] = ["idle"]
    private var progress: CGFloat = 0
    private var accessoryFadeStarted = false
    private var activeProgressTask: Task<Void, Never>?

    fileprivate init(
        screenshotPath: String,
        transitionSnapshotPath: String?,
        transitionController: AppshotCaptureTransition,
        target: AppshotTransitionTarget,
        viewportFrame: CGRect,
        transitionSnapshotHeight: Double?,
        appTitle: String?,
        bundleIdentifier: String?,
        layers: AppshotTransitionLayerRefs
    ) {
        self.transitionController = transitionController
        self.target = target
        self.viewportFrame = viewportFrame
        self.transitionSnapshotHeight = transitionSnapshotHeight.map { CGFloat($0) }
        self.appTitle = appTitle
        self.bundleIdentifier = bundleIdentifier
        snapshotImageSource = "screenshot"
        contentLayer = layers.contentLayer
        transitionBackgroundLayer = layers.transitionBackgroundLayer
        shadowLayer = layers.shadowLayer
        containerLayer = layers.containerLayer
        shutterLayer = layers.shutterLayer
        snapshotEffectsLayer = layers.snapshotEffectsLayer
        snapshotImageLayer = layers.snapshotImageLayer
        snapshotMaskLayer = layers.snapshotMaskLayer
        snapshotMaskDebugLayer = layers.snapshotMaskDebugLayer
        appIconLayer = layers.appIconLayer
        titleLayer = layers.titleLayer
        super.init(frame: CGRect(origin: .zero, size: viewportFrame.size))
        wantsLayer = true
        configureLayers(snapshotImagePath: screenshotPath)
    }

    required init?(coder: NSCoder) {
        nil
    }

    deinit {
        activeProgressTask?.cancel()
    }

    func play(duration: TimeInterval, completion: @escaping @Sendable () -> Void) {
        activeProgressTask?.cancel()
        activeProgressTask = nil
        overlayWindow = window as? AppshotTransitionOverlayWindow
        overlayWindow?.updateSnapshotImageSize(snapshotImageSize)
        activeAnimationDuration = duration
        progress = 0
        accessoryFadeStarted = false
        overlayWindow?.updateProgress(progress, accessoryFadeStarted: accessoryFadeStarted)
        activeTransitionPhaseHistory = []
        let startFrame = readStartFrame()
        let startCaptureFrame = readStartCaptureFrame()
        let endFrame = readEndFrame()
        let startBounds = CGRect(origin: .zero, size: startFrame.size)
        let endBounds = CGRect(origin: .zero, size: endFrame.size)
        let snapshotImageStartFrame = snapshotImageStartFrame(
            startFrame: startFrame,
            captureFrame: startCaptureFrame
        )
        let snapshotImageEndFrame = snapshotImageEndFrame(endFrame: endFrame)
        let initialCornerRadius = readInitialCornerRadius()
        let targetCornerRadius = readTargetCornerRadius()
        let shutterTargetCornerRadius = readShutterTargetCornerRadius()

        didStartTransition = true
        setTransitionPhase("shutter")
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        contentLayer.opacity = 1
        applyFrame(startFrame, to: shadowLayer)
        applyFrame(startFrame, to: containerLayer)
        applyFrame(startBounds, to: snapshotEffectsLayer)
        applyFrame(snapshotImageStartFrame, to: snapshotImageLayer)
        applyFrame(startBounds, to: snapshotMaskLayer)
        applyFrame(startBounds, to: snapshotMaskDebugLayer)
        applyFrame(startBounds, to: shutterLayer)
        shutterLayer.cornerRadius = initialCornerRadius
        shutterLayer.cornerCurve = .circular
        shutterLayer.opacity = 0
        snapshotEffectsLayer.cornerRadius = initialCornerRadius
        snapshotEffectsLayer.cornerCurve = .circular
        snapshotImageLayer.opacity = 0
        shadowLayer.opacity = 0
        appIconLayer.opacity = 0
        titleLayer.opacity = 0
        updateShadowPath(for: startFrame, radius: initialCornerRadius)
        updateSnapshotMaskPath(for: startBounds, radius: initialCornerRadius)
        layoutAccessoryLayers(in: startFrame)
        CATransaction.commit()

        layer?.displayIfNeeded()
        DispatchQueue.main.async {
            self.readyForMagicMove(
                startFrame: startFrame,
                endFrame: endFrame,
                startBounds: startBounds,
                endBounds: endBounds,
                snapshotImageStartFrame: snapshotImageStartFrame,
                snapshotImageEndFrame: snapshotImageEndFrame,
                initialCornerRadius: initialCornerRadius,
                targetCornerRadius: targetCornerRadius,
                shutterTargetCornerRadius: shutterTargetCornerRadius,
                totalDuration: duration,
                completion: completion
            )
        }
    }

    private func readyForMagicMove(
        startFrame: CGRect,
        endFrame: CGRect,
        startBounds: CGRect,
        endBounds: CGRect,
        snapshotImageStartFrame: CGRect,
        snapshotImageEndFrame: CGRect,
        initialCornerRadius: CGFloat,
        targetCornerRadius: CGFloat,
        shutterTargetCornerRadius: CGFloat,
        totalDuration: TimeInterval,
        completion: @escaping @Sendable () -> Void
    ) {
        let readyDuration = max(totalDuration * AppshotTransitionTiming.readyForMagicMove.doubleValue, 0.001)
        let fadeInProgress = min(
            1,
            AppshotTransitionTiming.shutterFadeIn.doubleValue / max(AppshotTransitionTiming.readyForMagicMove.doubleValue, 0.001)
        )

        CATransaction.begin()
        CATransaction.setCompletionBlock {
            self.setTransitionPhase("readyForMagicMove")
            let waitDuration = min(
                AppshotTransitionTiming.readyForMagicMoveWait,
                max(totalDuration - readyDuration, 0)
            )
            DispatchQueue.main.asyncAfter(deadline: .now() + waitDuration) {
                self.magicMove(
                    startFrame: startFrame,
                    endFrame: endFrame,
                    startBounds: startBounds,
                    endBounds: endBounds,
                    snapshotImageStartFrame: snapshotImageStartFrame,
                    snapshotImageEndFrame: snapshotImageEndFrame,
                    initialCornerRadius: initialCornerRadius,
                    targetCornerRadius: targetCornerRadius,
                    shutterTargetCornerRadius: shutterTargetCornerRadius,
                    duration: max(totalDuration - readyDuration - waitDuration, 0.001),
                    completion: completion
                )
            }
        }
        CATransaction.setDisableActions(true)
        animateOpacity(
            layer: shutterLayer,
            values: [0, AppshotLayerMetrics.shutterOpacity, AppshotLayerMetrics.shutterOpacity],
            keyTimes: [0, NSNumber(value: fadeInProgress), 1],
            duration: readyDuration,
            key: "appshotShutterFadeIn.readyForMagicMove"
        )
        shutterLayer.opacity = AppshotLayerMetrics.shutterOpacity
        CATransaction.commit()
    }

    private func magicMove(
        startFrame: CGRect,
        endFrame: CGRect,
        startBounds: CGRect,
        endBounds: CGRect,
        snapshotImageStartFrame: CGRect,
        snapshotImageEndFrame: CGRect,
        initialCornerRadius: CGFloat,
        targetCornerRadius: CGFloat,
        shutterTargetCornerRadius: CGFloat,
        duration: TimeInterval,
        completion: @escaping @Sendable () -> Void
    ) {
        let magicMoveStart = CACurrentMediaTime()
        activeProgressTask?.cancel()
        let timingFunction = AppshotTransitionTiming.magicMoveTimingFunction()
        let shutterFadeStart = normalizedMagicProgress(globalProgress: AppshotTransitionTiming.snapshotFadeIn).doubleValue
        let fadeProgressDuration = AppshotTransitionTiming.magicMoveFadeDuration / max(duration, 0.001)
        let shutterFadeEnd = min(1, shutterFadeStart + fadeProgressDuration)
        let snapshotFadeStart = shutterFadeStart
        let snapshotFadeEnd = shutterFadeEnd
        let shadowStart = normalizedMagicProgress(globalProgress: AppshotTransitionTiming.shadowFadeIn).doubleValue
        let accessoryFadeProgressDuration = AppshotTransitionTiming.accessoryFadeDuration / max(duration, 0.001)
        let appIconStart = normalizedMagicProgress(globalProgress: AppshotTransitionTiming.accessoryFadeStartProgress).doubleValue
        let startAccessoryFrame = accessoryFrame(in: startFrame)
        let endAccessoryFrame = accessoryFrame(in: endFrame)

        setTransitionPhase("magicMove")
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        applyFrame(endFrame, to: shadowLayer)
        applyFrame(endFrame, to: containerLayer)
        applyFrame(endBounds, to: snapshotEffectsLayer)
        applyFrame(snapshotImageEndFrame, to: snapshotImageLayer)
        applyFrame(endBounds, to: shutterLayer)
        applyFrame(endBounds, to: snapshotMaskLayer)
        applyFrame(endBounds, to: snapshotMaskDebugLayer)
        updateShadowPath(for: endFrame, radius: targetCornerRadius)
        updateSnapshotMaskPath(for: endBounds, radius: targetCornerRadius)
        layoutAccessoryLayers(in: endFrame)
        snapshotEffectsLayer.cornerRadius = targetCornerRadius
        shutterLayer.cornerRadius = shutterTargetCornerRadius
        shutterLayer.opacity = 0
        snapshotImageLayer.opacity = 1
        shadowLayer.opacity = 0
        appIconLayer.opacity = 0
        titleLayer.opacity = 0

        animateFrame(
            layer: shadowLayer,
            from: startFrame,
            to: endFrame,
            duration: duration,
            timingFunction: timingFunction,
            keyPrefix: "appshotShadowMagicMove"
        )
        animateFrame(
            layer: containerLayer,
            from: startFrame,
            to: endFrame,
            duration: duration,
            timingFunction: timingFunction,
            keyPrefix: "appshotContainerMagicMove"
        )
        animateFrame(
            layer: snapshotEffectsLayer,
            from: startBounds,
            to: endBounds,
            duration: duration,
            timingFunction: timingFunction,
            keyPrefix: "appshotSnapshotEffectsMagicMove"
        )
        animateFrame(
            layer: snapshotImageLayer,
            from: snapshotImageStartFrame,
            to: snapshotImageEndFrame,
            duration: duration,
            timingFunction: timingFunction,
            keyPrefix: "appshotSnapshotImageMagicMove"
        )
        animateFrame(
            layer: shutterLayer,
            from: startBounds,
            to: endBounds,
            duration: duration,
            timingFunction: timingFunction,
            keyPrefix: "appshotShutterMagicMove"
        )
        animateFrame(
            layer: snapshotMaskLayer,
            from: startBounds,
            to: endBounds,
            duration: duration,
            timingFunction: timingFunction,
            keyPrefix: "appshotSnapshotMaskMagicMove"
        )
        animateFrame(
            layer: snapshotMaskDebugLayer,
            from: startBounds,
            to: endBounds,
            duration: duration,
            timingFunction: timingFunction,
            keyPrefix: "appshotSnapshotMaskDebugMagicMove"
        )
        animateCornerRadius(
            layer: snapshotEffectsLayer,
            from: initialCornerRadius,
            to: targetCornerRadius,
            duration: duration,
            timingFunction: timingFunction,
            key: "appshotSnapshotCornerRadius"
        )
        animateCornerRadius(
            layer: shutterLayer,
            from: initialCornerRadius,
            to: shutterTargetCornerRadius,
            duration: duration,
            timingFunction: timingFunction,
            key: "appshotShutterCornerRadius"
        )
        animateShadowPath(
            fromFrame: startFrame,
            toFrame: endFrame,
            fromRadius: initialCornerRadius,
            toRadius: targetCornerRadius,
            duration: duration,
            timingFunction: timingFunction
        )
        animateMaskPath(
            layer: snapshotMaskLayer,
            fromBounds: startBounds,
            toBounds: endBounds,
            fromRadius: initialCornerRadius,
            toRadius: targetCornerRadius,
            duration: duration,
            timingFunction: timingFunction,
            key: "appshotSnapshotMaskPath"
        )
        animateMaskPath(
            layer: snapshotMaskDebugLayer,
            fromBounds: startBounds,
            toBounds: endBounds,
            fromRadius: initialCornerRadius,
            toRadius: targetCornerRadius,
            duration: duration,
            timingFunction: timingFunction,
            key: "appshotSnapshotMaskDebugPath"
        )
        animateOpacityKeyframes(
            layer: shutterLayer,
            values: [AppshotLayerMetrics.shutterOpacity, AppshotLayerMetrics.shutterOpacity, 0, 0],
            keyTimes: [0, NSNumber(value: shutterFadeStart), NSNumber(value: shutterFadeEnd), 1],
            duration: duration,
            key: "appshotShutterFadeOut"
        )
        animateOpacityKeyframes(
            layer: snapshotImageLayer,
            values: [0, 0, 1, 1],
            keyTimes: [0, NSNumber(value: snapshotFadeStart), NSNumber(value: snapshotFadeEnd), 1],
            duration: duration,
            key: "appshotSnapshotFadeIn"
        )
        animateOpacityKeyframes(
            layer: shadowLayer,
            values: [0, 0, 1, 1, 0],
            keyTimes: [0, NSNumber(value: shadowStart), NSNumber(value: min(1, shadowStart + 0.12)), 0.92, 1],
            duration: duration,
            key: "appshotShadowFadeIn"
        )
        animateFrame(
            layer: appIconLayer,
            from: startAccessoryFrame,
            to: endAccessoryFrame,
            duration: duration,
            timingFunction: timingFunction,
            keyPrefix: "appshotAppIconMagicMove"
        )
        animateAccessoryOpacity(
            layer: appIconLayer,
            start: appIconStart,
            fadeDuration: accessoryFadeProgressDuration,
            duration: duration,
            hasContent: appIconLayer.contents != nil,
            key: "appshotAppIconFadeIn"
        )
        animateFrame(
            layer: titleLayer,
            from: titleFrame(in: startFrame),
            to: titleFrame(in: endFrame),
            duration: duration,
            timingFunction: timingFunction,
            keyPrefix: "appshotTitleMagicMove"
        )
        animateAccessoryOpacity(
            layer: titleLayer,
            start: appIconStart,
            fadeDuration: accessoryFadeProgressDuration,
            duration: duration,
            hasContent: titleLayer.string != nil,
            key: "appshotTitleFadeIn"
        )
        CATransaction.commit()

        activeProgressTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let elapsed = max(CACurrentMediaTime() - magicMoveStart, 0)
                let linearProgress = min(max(elapsed / max(duration, 0.001), 0), 1)
                let easedProgress = self.easedMagicMoveProgress(linearProgress)
                let accessoryStarted = linearProgress >= appIconStart
                self.accessoryFadeStarted = self.accessoryFadeStarted || accessoryStarted
                self.overlayWindow?.updateProgress(
                    CGFloat(easedProgress),
                    accessoryFadeStarted: self.accessoryFadeStarted
                )
                if linearProgress < 1 {
                    try? await Task.sleep(nanoseconds: 8_333_333)
                    continue
                }
                self.activeProgressTask = nil
                self.progress = 1
                self.setTransitionPhase("finished")
                self.overlayWindow?.updateProgress(1, accessoryFadeStarted: self.accessoryFadeStarted)
                self.transitionController.requestCompletion()
                self.closeTransition(completion: completion)
                return
            }
        }
    }

    private func closeTransition(completion: @escaping @Sendable () -> Void) {
        setTransitionPhase("closing")
        DispatchQueue.main.asyncAfter(deadline: .now() + AppshotTransitionTiming.completionDelay) {
            self.setTransitionPhase("closed")
            completion()
        }
    }

    private func configureLayers(snapshotImagePath: String) {
        guard let rootLayer = layer else { return }
        rootLayer.masksToBounds = false
        rootLayer.backgroundColor = NSColor.clear.cgColor

        contentLayer.name = "contentLayer"
        transitionBackgroundLayer.name = "transitionBackgroundLayer"
        shadowLayer.name = "shadowLayer"
        containerLayer.name = "containerLayer"
        shutterLayer.name = "shutterLayer"
        snapshotEffectsLayer.name = "snapshotEffectsLayer"
        snapshotImageLayer.name = "snapshotImageLayer"
        snapshotMaskLayer.name = "snapshotMaskLayer"
        snapshotMaskDebugLayer.name = "snapshotMaskDebugLayer"
        appIconLayer.name = "appIconLayer"
        titleLayer.name = "titleLayer"

        contentLayer.frame = bounds
        contentLayer.masksToBounds = false
        contentLayer.backgroundColor = NSColor.clear.cgColor
        rootLayer.addSublayer(contentLayer)

        transitionBackgroundLayer.frame = bounds
        transitionBackgroundLayer.backgroundColor = NSColor.clear.cgColor
        transitionBackgroundLayer.opacity = 0
        contentLayer.addSublayer(transitionBackgroundLayer)

        shadowLayer.frame = .zero
        shadowLayer.backgroundColor = NSColor.clear.cgColor
        shadowLayer.shadowColor = NSColor.black.cgColor
        shadowLayer.shadowOpacity = AppshotLayerMetrics.shadowOpacity
        shadowLayer.shadowRadius = AppshotLayerMetrics.shadowRadius
        shadowLayer.shadowOffset = CGSize(width: 0, height: AppshotLayerMetrics.shadowYOffset)
        shadowLayer.opacity = 0
        contentLayer.addSublayer(shadowLayer)

        containerLayer.masksToBounds = false
        contentLayer.addSublayer(containerLayer)

        snapshotEffectsLayer.masksToBounds = true
        snapshotEffectsLayer.cornerRadius = AppshotLayerMetrics.screenshotCornerRadius
        snapshotEffectsLayer.cornerCurve = .circular
        snapshotEffectsLayer.backgroundColor = NSColor.clear.cgColor
        containerLayer.addSublayer(snapshotEffectsLayer)

        if let image = NSImage(contentsOfFile: snapshotImagePath) {
            var proposedRect = CGRect(origin: .zero, size: image.size)
            snapshotImageLayer.contents = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil)
            snapshotImageSize = proposedRect.size
            snapshotImageLayer.contentsGravity = .resizeAspect
            snapshotImageLayer.contentsScale = target.displayScaleFactor
            snapshotImageLayer.magnificationFilter = .linear
            snapshotImageLayer.minificationFilter = .trilinear
        }
        snapshotImageLayer.opacity = 0
        snapshotEffectsLayer.addSublayer(snapshotImageLayer)

        shutterLayer.frame = .zero
        shutterLayer.backgroundColor = NSColor.white.cgColor
        shutterLayer.opacity = AppshotLayerMetrics.shutterOpacity
        shutterLayer.masksToBounds = true
        shutterLayer.cornerRadius = AppshotLayerMetrics.screenshotCornerRadius
        shutterLayer.cornerCurve = .circular
        containerLayer.addSublayer(shutterLayer)

        snapshotMaskLayer.fillColor = NSColor.black.cgColor
        snapshotEffectsLayer.mask = snapshotMaskLayer

        snapshotMaskDebugLayer.isHidden = true
        snapshotMaskDebugLayer.strokeColor = NSColor.systemPink.cgColor
        snapshotMaskDebugLayer.fillColor = NSColor.clear.cgColor
        snapshotEffectsLayer.addSublayer(snapshotMaskDebugLayer)

        if let icon = readApplicationIconImage(bundleIdentifier: bundleIdentifier) {
            var proposedRect = CGRect(origin: .zero, size: icon.size)
            appIconLayer.contents = icon.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil)
            appIconLayer.contentsGravity = .resizeAspect
            appIconLayer.contentsScale = target.displayScaleFactor
            appIconLayer.magnificationFilter = .linear
            appIconLayer.minificationFilter = .trilinear
        }
        appIconLayer.opacity = 0
        contentLayer.addSublayer(appIconLayer)

        let resolvedTitle = appTitle?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !resolvedTitle.isEmpty {
            titleLayer.string = resolvedTitle
            titleLayer.foregroundColor = target.destinationPrimaryTextColor.cgColor
            titleLayer.alignmentMode = .center
            titleLayer.truncationMode = .end
            titleLayer.contentsScale = target.displayScaleFactor
            titleLayer.font = NSFont.systemFont(ofSize: AppshotLayerMetrics.titleFontSize, weight: .medium)
            titleLayer.fontSize = AppshotLayerMetrics.titleFontSize
            titleLayer.isWrapped = false
        }
        titleLayer.opacity = 0
        contentLayer.addSublayer(titleLayer)
    }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        contentLayer.frame = bounds
        transitionBackgroundLayer.frame = bounds
        if !didStartTransition {
            applyFrame(containerLayer.bounds, to: snapshotEffectsLayer)
            applyFrame(snapshotEffectsLayer.bounds, to: snapshotImageLayer)
            applyFrame(snapshotEffectsLayer.bounds, to: snapshotMaskLayer)
            applyFrame(snapshotEffectsLayer.bounds, to: snapshotMaskDebugLayer)
            applyFrame(containerLayer.bounds, to: shutterLayer)
        }
        CATransaction.commit()
    }

    private func readStartFrame() -> CGRect {
        let source = target.appKitSourceContentFrame
        return CGRect(
            x: source.minX - viewportFrame.minX,
            y: source.minY - viewportFrame.minY,
            width: source.width,
            height: source.height
        )
    }

    private func readStartCaptureFrame() -> CGRect {
        let source = target.appKitSourceWindowFrame
        return CGRect(
            x: source.minX - viewportFrame.minX,
            y: source.minY - viewportFrame.minY,
            width: source.width,
            height: source.height
        )
    }

    private func readEndFrame() -> CGRect {
        let destination = target.appKitDestinationFrame
        return CGRect(
            x: destination.minX - viewportFrame.minX,
            y: destination.minY - viewportFrame.minY,
            width: destination.width,
            height: destination.height
        )
    }

    private func applyFrame(_ frame: CGRect, to layer: CALayer) {
        layer.bounds = CGRect(origin: .zero, size: frame.size)
        layer.position = CGPoint(x: frame.midX, y: frame.midY)
    }

    private func setTransitionPhase(_ phase: String) {
        activeTransitionPhase = phase
        if activeTransitionPhaseHistory.last != phase {
            activeTransitionPhaseHistory.append(phase)
        }
        if let state = AppshotCaptureTransitionState(rawValue: phase) {
            transitionController.updateState(state)
        }
    }

    private func animateFrame(
        layer: CALayer,
        from startFrame: CGRect,
        to endFrame: CGRect,
        duration: TimeInterval,
        timingFunction: CAMediaTimingFunction,
        keyPrefix: String
    ) {
        animateBasic(
            layer: layer,
            keyPath: "bounds",
            from: NSValue(rect: CGRect(origin: .zero, size: startFrame.size)),
            to: NSValue(rect: CGRect(origin: .zero, size: endFrame.size)),
            duration: duration,
            timingFunction: timingFunction,
            key: "\(keyPrefix).bounds"
        )
        animateBasic(
            layer: layer,
            keyPath: "position",
            from: NSValue(point: CGPoint(x: startFrame.midX, y: startFrame.midY)),
            to: NSValue(point: CGPoint(x: endFrame.midX, y: endFrame.midY)),
            duration: duration,
            timingFunction: timingFunction,
            key: "\(keyPrefix).position"
        )
    }

    private func animateCornerRadius(
        layer: CALayer,
        from startRadius: CGFloat,
        to endRadius: CGFloat,
        duration: TimeInterval,
        timingFunction: CAMediaTimingFunction,
        key: String
    ) {
        animateBasic(
            layer: layer,
            keyPath: "cornerRadius",
            from: NSNumber(value: Double(startRadius)),
            to: NSNumber(value: Double(endRadius)),
            duration: duration,
            timingFunction: timingFunction,
            key: key
        )
    }

    private func animateShadowPath(
        fromFrame startFrame: CGRect,
        toFrame endFrame: CGRect,
        fromRadius startRadius: CGFloat,
        toRadius endRadius: CGFloat,
        duration: TimeInterval,
        timingFunction: CAMediaTimingFunction
    ) {
        animateBasic(
            layer: shadowLayer,
            keyPath: "shadowPath",
            from: CGPath(
                roundedRect: CGRect(origin: .zero, size: startFrame.size),
                cornerWidth: startRadius,
                cornerHeight: startRadius,
                transform: nil
            ),
            to: CGPath(
                roundedRect: CGRect(origin: .zero, size: endFrame.size),
                cornerWidth: endRadius,
                cornerHeight: endRadius,
                transform: nil
            ),
            duration: duration,
            timingFunction: timingFunction,
            key: "appshotShadowPath"
        )
    }

    private func animateMaskPath(
        layer: CAShapeLayer,
        fromBounds startBounds: CGRect,
        toBounds endBounds: CGRect,
        fromRadius startRadius: CGFloat,
        toRadius endRadius: CGFloat,
        duration: TimeInterval,
        timingFunction: CAMediaTimingFunction,
        key: String
    ) {
        animateBasic(
            layer: layer,
            keyPath: "path",
            from: CGPath(
                roundedRect: startBounds,
                cornerWidth: startRadius,
                cornerHeight: startRadius,
                transform: nil
            ),
            to: CGPath(
                roundedRect: endBounds,
                cornerWidth: endRadius,
                cornerHeight: endRadius,
                transform: nil
            ),
            duration: duration,
            timingFunction: timingFunction,
            key: key
        )
    }

    private func animateOpacityBasic(
        layer: CALayer,
        from startOpacity: Float,
        to endOpacity: Float,
        duration: TimeInterval,
        key: String
    ) {
        animateBasic(
            layer: layer,
            keyPath: "opacity",
            from: NSNumber(value: startOpacity),
            to: NSNumber(value: endOpacity),
            duration: max(duration, 0.001),
            timingFunction: CAMediaTimingFunction(name: .easeInEaseOut),
            key: key
        )
    }

    private func animateOpacityKeyframes(
        layer: CALayer,
        values: [Float],
        keyTimes: [NSNumber],
        duration: TimeInterval,
        key: String
    ) {
        let animation = CAKeyframeAnimation(keyPath: "opacity")
        animation.values = values
        animation.keyTimes = keyTimes
        animation.duration = max(duration, 0.001)
        animation.calculationMode = .linear
        animation.timingFunctions = values.dropFirst().map { _ in CAMediaTimingFunction(name: .easeInEaseOut) }
        layer.opacity = values.last ?? layer.opacity
        layer.add(animation, forKey: key)
    }

    private func animateAccessoryOpacity(
        layer: CALayer,
        start: Double,
        fadeDuration: Double,
        duration: TimeInterval,
        hasContent: Bool,
        key: String
    ) {
        guard hasContent else {
            return
        }
        let fadeInEnd = min(1, start + max(fadeDuration, 0.001))
        animateOpacityKeyframes(
            layer: layer,
            values: [0, 0, 1, 1],
            keyTimes: [0, NSNumber(value: start), NSNumber(value: fadeInEnd), 1],
            duration: duration,
            key: key
        )
    }

    private func animateBasic(
        layer: CALayer,
        keyPath: String,
        from startValue: Any,
        to endValue: Any,
        duration: TimeInterval,
        timingFunction: CAMediaTimingFunction,
        key: String
    ) {
        let animation = CABasicAnimation(keyPath: keyPath)
        animation.fromValue = startValue
        animation.toValue = endValue
        animation.duration = max(duration, 0.001)
        animation.timingFunction = timingFunction
        layer.add(animation, forKey: key)
    }

    private func snapshotImageStartFrame(startFrame: CGRect, captureFrame: CGRect) -> CGRect {
        guard captureFrame.width > 0, captureFrame.height > 0 else {
            return CGRect(origin: .zero, size: startFrame.size)
        }
        return CGRect(
            x: captureFrame.minX - startFrame.minX,
            y: captureFrame.minY - startFrame.minY,
            width: captureFrame.width,
            height: captureFrame.height
        )
    }

    private func snapshotImageEndFrame(endFrame: CGRect) -> CGRect {
        aspectFitRect(
            sourceSize: snapshotImageSize,
            targetBounds: CGRect(origin: .zero, size: endFrame.size),
            verticalAlignment: .center
        )
    }

    private func sourceContentBounds(in startFrame: CGRect, contentFrame: CGRect) -> CGRect {
        guard startFrame.width > 0,
              startFrame.height > 0,
              contentFrame.width > 0,
              contentFrame.height > 0
        else {
            return CGRect(origin: .zero, size: startFrame.size)
        }
        return CGRect(
            x: contentFrame.minX - startFrame.minX,
            y: contentFrame.minY - startFrame.minY,
            width: min(contentFrame.width, startFrame.width),
            height: min(contentFrame.height, startFrame.height)
        )
    }

    private func readInitialCornerRadius() -> CGFloat {
        AppshotLayerMetrics.screenshotCornerRadius
    }

    private func readTargetCornerRadius() -> CGFloat {
        max(target.destinationCornerRadius, 0)
    }

    private func readShutterTargetCornerRadius() -> CGFloat {
        readInitialCornerRadius()
    }

    private func updateShadowPath(for frame: CGRect, radius: CGFloat) {
        shadowLayer.shadowPath = CGPath(
            roundedRect: CGRect(origin: .zero, size: frame.size),
            cornerWidth: radius,
            cornerHeight: radius,
            transform: nil
        )
    }

    private func updateSnapshotMaskPath(for bounds: CGRect, radius: CGFloat) {
        snapshotMaskLayer.path = CGPath(
            roundedRect: bounds,
            cornerWidth: radius,
            cornerHeight: radius,
            transform: nil
        )
        snapshotMaskDebugLayer.path = snapshotMaskLayer.path
    }

    private func layoutAccessoryLayers(in frame: CGRect) {
        appIconLayer.frame = accessoryFrame(in: frame)
        titleLayer.frame = titleFrame(in: frame)
    }

    private func accessoryFrame(in frame: CGRect) -> CGRect {
        let iconSize = AppshotLayerMetrics.appIconSize
        return CGRect(
            x: frame.midX - iconSize / 2,
            y: frame.minY + AppshotLayerMetrics.appIconBottomInset,
            width: iconSize,
            height: iconSize
        )
    }

    private func titleFrame(in frame: CGRect) -> CGRect {
        let titleInset = min(AppshotLayerMetrics.titleHorizontalInset, max(frame.width / 2 - 1, 0))
        return CGRect(
            x: frame.minX + titleInset,
            y: frame.minY - AppshotLayerMetrics.titleTopMargin - AppshotLayerMetrics.titleHeight,
            width: max(frame.width - titleInset * 2, 1),
            height: AppshotLayerMetrics.titleHeight
        )
    }

    private func normalizedMagicProgress(globalProgress: NSNumber) -> NSNumber {
        let ready = AppshotTransitionTiming.readyForMagicMove.doubleValue
        let progress = (globalProgress.doubleValue - ready) / max(1 - ready, 0.001)
        return NSNumber(value: min(1, max(0, progress)))
    }

    private func easedMagicMoveProgress(_ progress: Double) -> Double {
        cubicBezierY(forX: progress, x1: 0.16, y1: 0, x2: 0.3, y2: 1)
    }

    private func cubicBezierY(forX x: Double, x1: Double, y1: Double, x2: Double, y2: Double) -> Double {
        let targetX = clampedUnit(x)
        var low = 0.0
        var high = 1.0
        var t = targetX
        for _ in 0..<12 {
            let currentX = cubicBezierValue(t: t, p1: x1, p2: x2)
            if abs(currentX - targetX) < 0.0005 {
                break
            }
            if currentX < targetX {
                low = t
            } else {
                high = t
            }
            t = (low + high) / 2
        }
        return clampedUnit(cubicBezierValue(t: t, p1: y1, p2: y2))
    }

    private func cubicBezierValue(t: Double, p1: Double, p2: Double) -> Double {
        let inverse = 1 - t
        return 3 * inverse * inverse * t * p1
            + 3 * inverse * t * t * p2
            + t * t * t
    }

    private func clampedUnit(_ value: Double) -> Double {
        min(max(value, 0), 1)
    }

    private func animateOpacity(layer: CALayer, values: [Float], keyTimes: [NSNumber], duration: TimeInterval, key: String) {
        let animation = CAKeyframeAnimation(keyPath: "opacity")
        animation.values = values
        animation.keyTimes = keyTimes
        animation.duration = duration
        animation.calculationMode = .linear
        animation.timingFunctions = values.dropFirst().map { _ in CAMediaTimingFunction(name: .easeInEaseOut) }
        layer.opacity = values.last ?? layer.opacity
        layer.add(animation, forKey: key)
    }

    func readPresentationProbeSample(
        outputDir: String,
        index: Int,
        startedAt: CFAbsoluteTime,
        renderImage: Bool
    ) throws -> [String: Any] {
        layoutSubtreeIfNeeded()
        let imagePath = (outputDir as NSString).appendingPathComponent("appshot-presentation-sample-\(String(format: "%03d", index)).png")
        var imageStatus = renderImage ? "missing" : "skipped"
        if renderImage, let rootLayer = layer {
            let image = try renderPresentationImage(rootLayer: rootLayer)
            try writeProbePNGImage(image, filePath: imagePath)
            imageStatus = "written"
        }
        return [
            "index": index,
            "capturedAt": isoTimestamp(),
            "elapsedSeconds": CFAbsoluteTimeGetCurrent() - startedAt,
            "imagePath": imageStatus == "written" ? imagePath : NSNull(),
            "imageStatus": imageStatus,
            "transitionPhase": activeTransitionPhase,
            "transitionPhaseHistory": activeTransitionPhaseHistory,
            "contentLayerOpacity": Double(readPresentationOpacity(contentLayer)),
            "transitionBackgroundOpacity": Double(readPresentationOpacity(transitionBackgroundLayer)),
            "shutterOpacity": Double(readPresentationOpacity(shutterLayer)),
            "coverOpacity": Double(readPresentationOpacity(shutterLayer)),
            "snapshotImageOpacity": Double(readPresentationOpacity(snapshotImageLayer)),
            "shadowOpacity": Double(readPresentationOpacity(shadowLayer)),
            "appIconOpacity": Double(readPresentationOpacity(appIconLayer)),
            "titleOpacity": Double(readPresentationOpacity(titleLayer)),
            "shutterCornerRadius": Double(readPresentationCornerRadius(shutterLayer)),
            "coverCornerRadius": Double(readPresentationCornerRadius(shutterLayer)),
            "snapshotCornerRadius": Double(readPresentationCornerRadius(snapshotEffectsLayer)),
            "shadowCornerRadius": Double(AppshotLayerMetrics.shadowCornerRadius),
            "screenshotCornerRadius": Double(AppshotLayerMetrics.screenshotCornerRadius),
            "initialCornerRadius": Double(readInitialCornerRadius()),
            "targetCornerRadius": Double(readTargetCornerRadius()),
            "shutterTargetCornerRadius": Double(readShutterTargetCornerRadius()),
            "readyForMagicMoveProgress": AppshotTransitionTiming.readyForMagicMove.doubleValue,
            "magicMoveFadeDuration": AppshotTransitionTiming.magicMoveFadeDuration,
            "visualHandoffStartProgress": AppshotTransitionTiming.visualHandoffStartProgress.doubleValue,
            "magicMoveFadeEndProgress": AppshotTransitionTiming.magicMoveFadeEndProgress(
                duration: activeAnimationDuration
            ).doubleValue,
            "accessoryFadeStartProgress": AppshotTransitionTiming.accessoryFadeStartProgress.doubleValue,
            "accessoryFadeDuration": AppshotTransitionTiming.accessoryFadeDuration,
            "coverBackgroundColor": serializeColor(shutterLayer.backgroundColor),
            "shutterBackgroundColor": serializeColor(shutterLayer.backgroundColor),
            "snapshotBackgroundColor": serializeColor(snapshotEffectsLayer.backgroundColor),
            "snapshotImageHasContents": snapshotImageLayer.contents != nil,
            "snapshotImageSource": snapshotImageSource,
            "snapshotImageContentsScale": Double(snapshotImageLayer.contentsScale),
            "snapshotImageSize": serialize(rect: CGRect(origin: .zero, size: snapshotImageSize)),
            "layerTypes": [
                "transitionBackgroundLayer": String(describing: type(of: transitionBackgroundLayer)),
                "shadowLayer": String(describing: type(of: shadowLayer)),
                "containerLayer": String(describing: type(of: containerLayer)),
                "shutterLayer": String(describing: type(of: shutterLayer)),
                "snapshotEffectsLayer": String(describing: type(of: snapshotEffectsLayer)),
                "snapshotImageLayer": String(describing: type(of: snapshotImageLayer)),
                "snapshotMaskLayer": String(describing: type(of: snapshotMaskLayer)),
                "snapshotMaskDebugLayer": String(describing: type(of: snapshotMaskDebugLayer)),
                "appIconLayer": String(describing: type(of: appIconLayer)),
                "titleLayer": String(describing: type(of: titleLayer)),
            ],
            "layerHierarchy": [
                "rootSublayers": readLayerNames(layer?.sublayers),
                "contentLayerSublayers": readLayerNames(contentLayer.sublayers),
                "containerLayerSublayers": readLayerNames(containerLayer.sublayers),
                "snapshotEffectsLayerSublayers": readLayerNames(snapshotEffectsLayer.sublayers),
                "snapshotEffectsLayerMask": readLayerName(snapshotEffectsLayer.mask),
            ],
            "expectedStartFrame": serialize(rect: readStartFrame()),
            "expectedStartCaptureFrame": serialize(rect: readStartCaptureFrame()),
            "expectedStartContentFrame": serialize(rect: readStartFrame()),
            "expectedStartContentBounds": serialize(rect: sourceContentBounds(
                in: readStartFrame(),
                contentFrame: readStartFrame()
            )),
            "expectedSnapshotImageStartFrame": serialize(rect: snapshotImageStartFrame(
                startFrame: readStartFrame(),
                captureFrame: readStartCaptureFrame()
            )),
            "expectedSnapshotImageEndFrame": serialize(rect: snapshotImageEndFrame(endFrame: readEndFrame())),
            "expectedEndFrame": serialize(rect: readEndFrame()),
            "transitionSnapshotHeight": transitionSnapshotHeight.map(Double.init) ?? NSNull(),
            "transitionSnapshotHeightAffectsNativeTarget": false,
            "containerFrame": serialize(rect: readPresentationFrame(containerLayer)),
            "shutterFrame": serialize(rect: readPresentationFrame(shutterLayer)),
            "coverFrame": serialize(rect: readPresentationFrame(shutterLayer)),
            "snapshotFrame": serialize(rect: readPresentationFrame(snapshotEffectsLayer)),
            "snapshotImageFrame": serialize(rect: readPresentationFrame(snapshotImageLayer)),
            "shadowFrame": serialize(rect: readPresentationFrame(shadowLayer)),
            "appIconFrame": serialize(rect: readPresentationFrame(appIconLayer)),
            "titleFrame": serialize(rect: readPresentationFrame(titleLayer)),
            "modelContainerFrame": serialize(rect: containerLayer.frame),
            "modelShutterFrame": serialize(rect: shutterLayer.frame),
            "modelCoverFrame": serialize(rect: shutterLayer.frame),
            "modelSnapshotFrame": serialize(rect: snapshotEffectsLayer.frame),
            "modelSnapshotImageFrame": serialize(rect: snapshotImageLayer.frame),
            "modelShadowFrame": serialize(rect: shadowLayer.frame),
            "modelAppIconFrame": serialize(rect: appIconLayer.frame),
            "modelTitleFrame": serialize(rect: titleLayer.frame),
        ]
    }

    private func renderPresentationImage(rootLayer: CALayer) throws -> CGImage {
        let scale = max(target.displayScaleFactor, 1)
        let pixelWidth = max(Int(ceil(bounds.width * scale)), 1)
        let pixelHeight = max(Int(ceil(bounds.height * scale)), 1)
        guard let context = CGContext(
            data: nil,
            width: pixelWidth,
            height: pixelHeight,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            throw BridgeError("appshot-presentation-context-unavailable", "Could not create Appshot presentation render context.")
        }
        context.scaleBy(x: scale, y: scale)
        (rootLayer.presentation() ?? rootLayer).render(in: context)
        guard let image = context.makeImage() else {
            throw BridgeError("appshot-presentation-image-unavailable", "Could not render Appshot presentation layer into an image.")
        }
        return image
    }

    private func readPresentationFrame(_ layer: CALayer) -> CGRect {
        (layer.presentation() ?? layer).frame
    }

    private func readPresentationOpacity(_ layer: CALayer) -> Float {
        (layer.presentation() ?? layer).opacity
    }

    private func readPresentationCornerRadius(_ layer: CALayer) -> CGFloat {
        (layer.presentation() ?? layer).cornerRadius
    }

    private func readLayerNames(_ layers: [CALayer]?) -> [String] {
        layers?.map { layer in
            layer.name ?? String(describing: type(of: layer))
        } ?? []
    }

    private func readLayerName(_ layer: CALayer?) -> Any {
        guard let layer else {
            return NSNull()
        }
        return layer.name ?? String(describing: type(of: layer))
    }

    private func serializeColor(_ color: CGColor?) -> Any {
        guard let color else {
            return NSNull()
        }
        let nsColor = NSColor(cgColor: color)?.usingColorSpace(.deviceRGB)
        guard let nsColor else {
            return NSNull()
        }
        return [
            "red": Double(nsColor.redComponent),
            "green": Double(nsColor.greenComponent),
            "blue": Double(nsColor.blueComponent),
            "alpha": Double(nsColor.alphaComponent),
        ]
    }
}

func aspectFitRect(
    sourceSize: CGSize,
    targetBounds: CGRect,
    verticalAlignment: AppshotVerticalAlignment
) -> CGRect {
    guard sourceSize.width > 0,
          sourceSize.height > 0,
          targetBounds.width > 0,
          targetBounds.height > 0
    else {
        return targetBounds
    }
    let scale = min(targetBounds.width / sourceSize.width, targetBounds.height / sourceSize.height)
    let width = sourceSize.width * scale
    let height = sourceSize.height * scale
    let x = targetBounds.midX - width / 2
    let y: CGFloat
    switch verticalAlignment {
    case .center:
        y = targetBounds.midY - height / 2
    case .bottom:
        y = targetBounds.minY
    }
    return CGRect(x: x, y: y, width: width, height: height)
}

private func readApplicationIconImage(bundleIdentifier: String?) -> NSImage? {
    guard let bundleIdentifier,
          !bundleIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
        return nil
    }
    if let application = NSRunningApplication
        .runningApplications(withBundleIdentifier: bundleIdentifier)
        .first(where: { !$0.isTerminated }),
        let icon = application.icon {
        return icon
    }
    guard let appURL = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier) else {
        return nil
    }
    return NSWorkspace.shared.icon(forFile: appURL.path)
}

private func serializeCGColorForProbe(_ color: CGColor?) -> Any {
    guard let color else {
        return NSNull()
    }
    guard let components = color.components else {
        return [
            "componentCount": color.numberOfComponents,
        ]
    }
    return [
        "componentCount": color.numberOfComponents,
        "components": components.map(Double.init),
    ]
}

private func readColor(_ value: String?) -> NSColor? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    let hex = trimmed.hasPrefix("#") ? String(trimmed.dropFirst()) : trimmed
    guard hex.count == 6 || hex.count == 8,
          let raw = UInt64(hex, radix: 16)
    else {
        return nil
    }

    let red: CGFloat
    let green: CGFloat
    let blue: CGFloat
    let alpha: CGFloat
    if hex.count == 8 {
        red = CGFloat((raw >> 24) & 0xff) / 255
        green = CGFloat((raw >> 16) & 0xff) / 255
        blue = CGFloat((raw >> 8) & 0xff) / 255
        alpha = CGFloat(raw & 0xff) / 255
    } else {
        red = CGFloat((raw >> 16) & 0xff) / 255
        green = CGFloat((raw >> 8) & 0xff) / 255
        blue = CGFloat(raw & 0xff) / 255
        alpha = 1
    }
    return NSColor(calibratedRed: red, green: green, blue: blue, alpha: alpha)
}

private func readFiniteDouble(_ raw: Any?) -> Double? {
    guard let number = raw as? NSNumber else { return nil }
    let value = number.doubleValue
    guard value.isFinite else { return nil }
    return value
}

private func readPositiveDouble(_ raw: Any?) -> Double? {
    guard let value = readFiniteDouble(raw), value > 0 else { return nil }
    return value
}
