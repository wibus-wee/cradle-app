// Runs the cradle-mac-bridge NDJSON server and owns macOS native capabilities.
import AppKit
import ApplicationServices
import CoreGraphics
import Foundation

let bridgeVersion = "0.1.0"
let leftCommandKeyCode: CGKeyCode = 0x37
let rightCommandKeyCode: CGKeyCode = 0x36
let leftOptionKeyCode: CGKeyCode = 0x3A
let rightOptionKeyCode: CGKeyCode = 0x3D
let leftShiftKeyCode: CGKeyCode = 0x38
let rightShiftKeyCode: CGKeyCode = 0x3C
let leftCommandDeviceFlag: UInt64 = 0x00000008
let rightCommandDeviceFlag: UInt64 = 0x00000010
let leftOptionDeviceFlag: UInt64 = 0x00000020
let rightOptionDeviceFlag: UInt64 = 0x00000040
let leftShiftDeviceFlag: UInt64 = 0x00000002
let rightShiftDeviceFlag: UInt64 = 0x00000004
let cradleApplicationBundleIdentifiers: Set<String> = [
    "com.cradle.app",
    "com.github.Electron",
]
let frontmostWindowTracker = FrontmostWindowTracker(excludedBundleIdentifiers: cradleApplicationBundleIdentifiers)

final class BridgeError: Error, @unchecked Sendable {
    let code: String
    let message: String
    let details: [String: String]?

    init(_ code: String, _ message: String, details: [String: String]? = nil) {
        self.code = code
        self.message = message
        self.details = details
    }
}

final class OutputWriter: @unchecked Sendable {
    private let lock = NSLock()

    func send(_ object: [String: Any]) {
        lock.lock()
        defer { lock.unlock() }

        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let line = String(data: data, encoding: .utf8)
        else {
            fputs("{\"error\":{\"code\":\"serialization-failed\",\"message\":\"Failed to serialize bridge output\"}}\n", stdout)
            fflush(stdout)
            return
        }
        fputs("\(line)\n", stdout)
        fflush(stdout)
    }

    func respond(id: String, result: Any) {
        send(["id": id, "result": result])
    }

    func reject(id: String, error: BridgeError) {
        var payload: [String: Any] = [
            "code": error.code,
            "message": error.message,
        ]
        if let details = error.details {
            payload["details"] = details
        }
        send(["id": id, "error": payload])
    }

    func event(method: String, params: [String: Any]) {
        send(["method": method, "params": params])
    }
}

struct WindowCandidate {
    let windowId: Int
    let appName: String?
    let bundleId: String?
    let processId: Int
    let title: String?
    let bounds: [String: Double]?
    let axTree: String?
    let frameEvidence: WindowFrameEvidence?
}

struct WindowTarget {
    let windowId: Int
    let processId: Int?
    let bundleId: String?
}

struct AccessibilityWindowSnapshot {
    let title: String?
    let frame: CGRect?
    let axTree: String?
}

struct WindowFrameEvidence {
    let coreGraphicsBounds: [String: Double]?
    let accessibilityFrame: CGRect?
}

final class FrontmostWindowTracker: @unchecked Sendable {
    private let lock = NSLock()
    private let excludedBundleIdentifiers: Set<String>
    private var lastWindow: WindowCandidate?
    private var observer: NSObjectProtocol?

    init(excludedBundleIdentifiers: Set<String>) {
        self.excludedBundleIdentifiers = excludedBundleIdentifiers
    }

    @MainActor
    func start() {
        recordCurrentFrontmostApplication()
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let self,
                  let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication else {
                return
            }
            self.record(application: application)
        }
    }

    @MainActor
    func stop() {
        if let observer {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
        }
        observer = nil
    }

    func readLastWindow() -> WindowCandidate? {
        lock.lock()
        defer { lock.unlock() }
        return lastWindow
    }

    func readLastWindowPayload() -> [String: Any]? {
        guard let window = readLastWindow() else {
            return nil
        }
        return serialize(window: window)
    }

    func readLastWindowTargetPayload() -> [String: Any]? {
        guard let window = readLastWindow() else {
            return nil
        }
        var target: [String: Any] = [
            "windowId": window.windowId,
            "processId": window.processId,
        ]
        if let bundleId = window.bundleId, !bundleId.isEmpty {
            target["bundleId"] = bundleId
        }
        return target
    }

    private func recordCurrentFrontmostApplication() {
        guard let application = NSWorkspace.shared.frontmostApplication else {
            return
        }
        record(application: application)
    }

    private func record(application: NSRunningApplication) {
        guard !isExcluded(application: application),
              let window = try? readWindowForApplication(application) else {
            return
        }
        lock.lock()
        lastWindow = window
        lock.unlock()
    }

    private func isExcluded(application: NSRunningApplication) -> Bool {
        guard let bundleIdentifier = application.bundleIdentifier else {
            return false
        }
        return excludedBundleIdentifiers.contains(bundleIdentifier)
    }
}

final class InputMonitor: @unchecked Sendable {
    private let output: OutputWriter
    private let stateLock = NSLock()
    private var eventTap: CFMachPort?
    private var trigger = BareModifierTrigger.doubleCommand
    private var enabled = false
    private var tapEnableAttempted = false
    private var runLoopSourceCreated = false
    private var observedEventCount = 0
    private var lastEventAt: String?
    private var lastDisabledReason: String?
    private var lastSetupError: String?
    private var leftModifierDown = false
    private var rightModifierDown = false
    private var firedForCurrentPress = false
    private var debugEventsRemaining = 0
    private var debugSessionId = 0
    private var thread: Thread?

    init(output: OutputWriter) {
        self.output = output
    }

    func configure(trigger nextTrigger: BareModifierTrigger, enabled nextEnabled: Bool) throws {
        stateLock.lock()
        trigger = nextTrigger
        leftModifierDown = false
        rightModifierDown = false
        firedForCurrentPress = false
        stateLock.unlock()

        if nextEnabled {
            try start()
        } else {
            stop()
        }
    }

    func debugNextEvents(count: Int, timeoutSeconds: Double) throws {
        let sessionId: Int
        let initialObservedEventCount: Int
        stateLock.lock()
        debugEventsRemaining = max(0, count)
        debugSessionId += 1
        sessionId = debugSessionId
        initialObservedEventCount = observedEventCount
        stateLock.unlock()

        try configure(trigger: trigger, enabled: true)
        scheduleDebugTimeout(sessionId: sessionId, initialObservedEventCount: initialObservedEventCount, timeoutSeconds: timeoutSeconds)
    }

    func diagnostics() -> [String: Any] {
        stateLock.lock()
        let tap = eventTap
        let snapshot: [String: Any] = [
            "trigger": trigger.rawValue,
            "enabled": enabled,
            "tapCreated": tap != nil,
            "tapEnabled": tap.map { CGEvent.tapIsEnabled(tap: $0) } ?? false,
            "tapEnableAttempted": tapEnableAttempted,
            "runLoopSourceCreated": runLoopSourceCreated,
            "observedEventCount": observedEventCount,
            "lastEventAt": lastEventAt ?? NSNull(),
            "lastDisabledReason": lastDisabledReason ?? NSNull(),
            "lastSetupError": lastSetupError ?? NSNull(),
            "leftModifierDown": leftModifierDown,
            "rightModifierDown": rightModifierDown,
            "permissions": permissionStatus(),
        ]
        stateLock.unlock()
        return snapshot
    }

    private func start() throws {
        if enabled {
            return
        }
        let eventMask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: eventMask,
            callback: { _, type, event, refcon in
                guard let refcon else {
                    return Unmanaged.passUnretained(event)
                }
                let monitor = Unmanaged<InputMonitor>.fromOpaque(refcon).takeUnretainedValue()
                if type == .flagsChanged {
                    monitor.handle(event: event)
                } else if type == .tapDisabledByTimeout {
                    monitor.handleTapDisabled(reason: "timeout")
                } else if type == .tapDisabledByUserInput {
                    monitor.handleTapDisabled(reason: "userInput")
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else {
            throw BridgeError("input-monitor-unavailable", "Mac Bridge could not create a modifier-key event tap. Input Monitoring or Accessibility permission may be required.")
        }

        stateLock.lock()
        enabled = true
        eventTap = tap
        tapEnableAttempted = false
        runLoopSourceCreated = false
        lastSetupError = nil
        stateLock.unlock()

        thread = Thread { [weak self] in
            guard let self, let eventTap = self.eventTap else { return }
            guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0) else {
                self.recordSetupError("run-loop-source-unavailable")
                return
            }
            self.stateLock.lock()
            self.runLoopSourceCreated = true
            self.stateLock.unlock()
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
            CGEvent.tapEnable(tap: eventTap, enable: true)
            self.stateLock.lock()
            self.tapEnableAttempted = true
            self.stateLock.unlock()
            RunLoop.current.run()
        }
        thread?.name = "CradleMacBridgeInputMonitor"
        thread?.start()
    }

    private func stop() {
        stateLock.lock()
        enabled = false
        if let eventTap {
            CFMachPortInvalidate(eventTap)
        }
        eventTap = nil
        tapEnableAttempted = false
        runLoopSourceCreated = false
        leftModifierDown = false
        rightModifierDown = false
        firedForCurrentPress = false
        debugEventsRemaining = 0
        debugSessionId += 1
        stateLock.unlock()
    }

    private func handle(event: CGEvent) {
        let eventState = updateModifierState(event: event)
        emitDebugEvent(eventState)
        let hasBothModifiers = (eventState["leftModifierDown"] as? Bool) == true
            && (eventState["rightModifierDown"] as? Bool) == true
        if !hasBothModifiers {
            stateLock.lock()
            firedForCurrentPress = false
            stateLock.unlock()
            return
        }
        stateLock.lock()
        if firedForCurrentPress {
            stateLock.unlock()
            return
        }
        firedForCurrentPress = true
        stateLock.unlock()
        var params: [String: Any] = [
            "trigger": eventState["trigger"] as? String ?? BareModifierTrigger.doubleCommand.rawValue,
            "capturedAt": isoTimestamp(),
        ]
        if let targetWindow = frontmostWindowTracker.readLastWindowTargetPayload() {
            params["targetWindow"] = targetWindow
        }
        if let sourceWindow = frontmostWindowTracker.readLastWindowPayload() {
            params["sourceWindow"] = sourceWindow
            if let bundleIdentifier = sourceWindow["bundleId"] as? String, !bundleIdentifier.isEmpty {
                params["bundleIdentifier"] = bundleIdentifier
            }
        }
        output.event(method: "event.mac.hotkeyTriggered", params: params)
    }

    private func updateModifierState(event: CGEvent) -> [String: Any] {
        let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
        let flagsRaw = event.flags.rawValue
        stateLock.lock()
        observedEventCount += 1
        lastEventAt = isoTimestamp()
        let selectedTrigger = trigger
        leftModifierDown = (flagsRaw & selectedTrigger.leftDeviceFlag) != 0
        rightModifierDown = (flagsRaw & selectedTrigger.rightDeviceFlag) != 0
        let snapshot: [String: Any] = [
            "trigger": selectedTrigger.rawValue,
            "keyCode": Int(keyCode),
            "flagsRaw": flagsRaw,
            "hasModifierFlag": event.flags.contains(selectedTrigger.modifierFlag),
            "leftModifierDown": leftModifierDown,
            "rightModifierDown": rightModifierDown,
            "observedEventCount": observedEventCount,
        ]
        stateLock.unlock()
        return snapshot
    }

    private func emitDebugEvent(_ eventState: [String: Any]) {
        stateLock.lock()
        guard debugEventsRemaining > 0 else {
            stateLock.unlock()
            return
        }
        debugEventsRemaining -= 1
        stateLock.unlock()
        output.event(method: "event.mac.inputDebug", params: eventState)
    }

    private func handleTapDisabled(reason: String) {
        stateLock.lock()
        lastDisabledReason = reason
        let tap = eventTap
        stateLock.unlock()

        output.event(method: "event.mac.inputMonitorDisabled", params: [
            "reason": reason,
            "capturedAt": isoTimestamp(),
        ])

        if let tap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
    }

    private func recordSetupError(_ message: String) {
        stateLock.lock()
        lastSetupError = message
        stateLock.unlock()
        output.event(method: "event.mac.inputMonitorSetupFailed", params: [
            "message": message,
            "capturedAt": isoTimestamp(),
        ])
    }

    private func scheduleDebugTimeout(sessionId: Int, initialObservedEventCount: Int, timeoutSeconds: Double) {
        let timeoutNanoseconds = UInt64(max(timeoutSeconds, 0.5) * 1_000_000_000)
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + .nanoseconds(Int(timeoutNanoseconds))) { [weak self] in
            guard let self else { return }
            self.stateLock.lock()
            let shouldReport = self.debugSessionId == sessionId
                && self.debugEventsRemaining > 0
                && self.observedEventCount == initialObservedEventCount
            self.stateLock.unlock()
            if shouldReport {
                self.output.event(method: "event.mac.inputDebugTimeout", params: [
                    "timeoutSeconds": timeoutSeconds,
                    "diagnostics": self.diagnostics(),
                ])
            }
        }
    }
}

final class BridgeRuntime: @unchecked Sendable {
    private let output = OutputWriter()
    private let feedbackPresenter = FeedbackIndicatorPresenter()
    private let appshotTransitionPresenter = AppshotTransitionPresenter()
    private let displayRecordingRegistry = DisplayRecordingRegistry()
    private lazy var inputMonitor = InputMonitor(output: output)

    @MainActor
    func run() {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.finishLaunching()
        frontmostWindowTracker.start()

        DispatchQueue.global(qos: .userInitiated).async {
            self.readInputLoop()
        }
        application.run()
    }

    private func readInputLoop() {
        defer {
            try? inputMonitor.configure(trigger: .doubleCommand, enabled: false)
            Task { @MainActor in
                frontmostWindowTracker.stop()
                NSApplication.shared.terminate(nil)
            }
        }

        while let line = readLine() {
            handle(line: line)
        }
    }

    private func handle(line: String) {
        guard let data = line.data(using: .utf8),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = raw["id"] as? String,
              let method = raw["method"] as? String
        else {
            return
        }

        do {
            let params = raw["params"] as? [String: Any] ?? [:]
            let result = try handle(method: method, params: params)
            output.respond(id: id, result: result)
        } catch let error as BridgeError {
            output.reject(id: id, error: error)
        } catch {
            output.reject(id: id, error: BridgeError("unknown-error", "\(error)"))
        }
    }

    private func handle(method: String, params: [String: Any]) throws -> Any {
        switch method {
        case "bridge.status":
            return [
                "name": "cradle-mac-bridge",
                "version": bridgeVersion,
                "pid": Int(ProcessInfo.processInfo.processIdentifier),
                "platform": "darwin",
            ]
        case "mac.permissions.status":
            return permissionStatus()
        case "mac.permissions.request":
            return requestPermissions(params: params)
        case "mac.permissions.openSettings":
            return try openPermissionSettings(params: params)
        case "mac.input.configure":
            guard let rawTrigger = params["trigger"] as? String,
                  let trigger = BareModifierTrigger(rawValue: rawTrigger),
                  let enabled = params["enabled"] as? Bool
            else {
                throw BridgeError("invalid-params", "mac.input.configure requires trigger DoubleCommand, DoubleOption, or DoubleShift and enabled boolean.")
            }
            try inputMonitor.configure(trigger: trigger, enabled: enabled)
            return [
                "trigger": trigger.rawValue,
                "enabled": enabled,
                "diagnostics": inputMonitor.diagnostics(),
            ]
        case "mac.input.diagnostics":
            return inputMonitor.diagnostics()
        case "mac.input.debugNext":
            let count = params["count"] as? Int ?? 8
            let timeoutSeconds = (params["timeoutSeconds"] as? NSNumber)?.doubleValue ?? 3
            try inputMonitor.debugNextEvents(count: count, timeoutSeconds: timeoutSeconds)
            return [
                "count": count,
                "timeoutSeconds": timeoutSeconds,
                "diagnostics": inputMonitor.diagnostics(),
            ]
        case "mac.input.syntheticBothCommand":
            return try synthesizeBothCommandHotkey(params: params)
        case "mac.input.syntheticBareModifier":
            return try synthesizeBareModifierHotkey(params: params)
        case "mac.capture.frontmostWindow":
            return try captureFrontmostWindow(params: params, feedbackPresenter: feedbackPresenter)
        case "mac.appshot.windowInventory":
            return try readAppshotWindowInventory()
        case "mac.appshot.frontmostContext":
            return try readAppshotFrontmostContext()
        case "mac.appshot.contextForWindow":
            return try readAppshotContextForWindow(params: params)
        case "mac.appshot.captureFrontmostWindow":
            return try captureAppshotFrontmostWindow(params: params, appshotTransitionPresenter: appshotTransitionPresenter)
        case "mac.appshot.probeTransitionVisibility":
            return try probeAppshotTransitionVisibility(params: params, appshotTransitionPresenter: appshotTransitionPresenter)
        case "mac.appshot.probeTransitionPresentation":
            return try probeAppshotTransitionPresentation(params: params, appshotTransitionPresenter: appshotTransitionPresenter)
        case "mac.screenCaptureKit.diagnostics":
            return readScreenCaptureKitDiagnostics()
        case "mac.recording.startDisplay":
            return try displayRecordingRegistry.start(params: params)
        case "mac.recording.finishDisplay":
            return try displayRecordingRegistry.finish(params: params)
        case "mac.recording.startWindow":
            return try displayRecordingRegistry.startWindow(params: params)
        case "mac.recording.finishWindow":
            return try displayRecordingRegistry.finish(params: params)
        default:
            throw BridgeError("unknown-method", "Unknown Mac Bridge method: \(method)")
        }
    }
}

func permissionStatus() -> [String: Any] {
    [
        "accessibility": AXIsProcessTrusted() ? "granted" : "denied",
        "screenRecording": CGPreflightScreenCaptureAccess() ? "granted" : "denied",
        "inputMonitoring": CGPreflightListenEventAccess() ? "granted" : "denied",
    ]
}

func requestPermissions(params: [String: Any]) -> [String: Any] {
    let permissions = readRequestedPermissions(params: params)
    var requested: [String] = []

    for permission in permissions {
        switch permission {
        case "accessibility":
            let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
            requested.append(permission)
        case "screenRecording":
            _ = CGRequestScreenCaptureAccess()
            requested.append(permission)
        case "inputMonitoring":
            _ = CGRequestListenEventAccess()
            requested.append(permission)
        default:
            continue
        }
    }

    return [
        "requested": requested,
        "status": permissionStatus(),
    ]
}

func readRequestedPermissions(params: [String: Any]) -> [String] {
    let defaultPermissions = ["accessibility", "inputMonitoring", "screenRecording"]
    guard let rawPermissions = params["permissions"] as? [String], !rawPermissions.isEmpty else {
        return defaultPermissions
    }
    return rawPermissions
}

func openPermissionSettings(params: [String: Any]) throws -> [String: Any] {
    let target = try readPermissionSettingsTarget(params: params)
    let urlString = permissionSettingsURLString(target: target)
    guard let url = URL(string: urlString) else {
        throw BridgeError("invalid-settings-url", "Mac Bridge could not build a System Settings URL.", details: [
            "target": target,
            "url": urlString,
        ])
    }

    let opened = NSWorkspace.shared.open(url)
    if !opened {
        throw BridgeError("settings-open-failed", "Mac Bridge could not open macOS System Settings.", details: [
            "target": target,
            "url": urlString,
        ])
    }

    return [
        "target": target,
        "url": urlString,
        "opened": opened,
    ]
}

func readPermissionSettingsTarget(params: [String: Any]) throws -> String {
    let target = params["target"] as? String ?? "privacy"
    let allowedTargets = ["privacy", "accessibility", "inputMonitoring", "screenRecording"]
    guard allowedTargets.contains(target) else {
        throw BridgeError("invalid-params", "mac.permissions.openSettings received an unsupported target.", details: [
            "target": target,
        ])
    }
    return target
}

func permissionSettingsURLString(target: String) -> String {
    switch target {
    case "accessibility":
        return "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    case "inputMonitoring":
        return "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
    case "screenRecording":
        return "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
    default:
        return "x-apple.systempreferences:com.apple.preference.security?Privacy"
    }
}

enum BareModifierTrigger: String {
    case doubleCommand = "DoubleCommand"
    case doubleOption = "DoubleOption"
    case doubleShift = "DoubleShift"

    var leftKeyCode: CGKeyCode {
        switch self {
        case .doubleCommand:
            return leftCommandKeyCode
        case .doubleOption:
            return leftOptionKeyCode
        case .doubleShift:
            return leftShiftKeyCode
        }
    }

    var rightKeyCode: CGKeyCode {
        switch self {
        case .doubleCommand:
            return rightCommandKeyCode
        case .doubleOption:
            return rightOptionKeyCode
        case .doubleShift:
            return rightShiftKeyCode
        }
    }

    var leftDeviceFlag: UInt64 {
        switch self {
        case .doubleCommand:
            return leftCommandDeviceFlag
        case .doubleOption:
            return leftOptionDeviceFlag
        case .doubleShift:
            return leftShiftDeviceFlag
        }
    }

    var rightDeviceFlag: UInt64 {
        switch self {
        case .doubleCommand:
            return rightCommandDeviceFlag
        case .doubleOption:
            return rightOptionDeviceFlag
        case .doubleShift:
            return rightShiftDeviceFlag
        }
    }

    var modifierFlag: CGEventFlags {
        switch self {
        case .doubleCommand:
            return .maskCommand
        case .doubleOption:
            return .maskAlternate
        case .doubleShift:
            return .maskShift
        }
    }
}

func synthesizeBothCommandHotkey(params: [String: Any]) throws -> [String: Any] {
    let result = try postSyntheticBareModifier(
        trigger: .doubleCommand,
        holdMilliseconds: readSyntheticHoldMilliseconds(
            params: params,
            method: "mac.input.syntheticBothCommand"
        )
    )
    return [
        "trigger": "bothCommand",
        "holdMilliseconds": result.holdMilliseconds,
        "postedEventCount": result.postedEventCount,
        "postedAt": result.postedAt,
    ]
}

func synthesizeBareModifierHotkey(params: [String: Any]) throws -> [String: Any] {
    let rawTrigger = params["modifier"] as? String ?? BareModifierTrigger.doubleCommand.rawValue
    guard let trigger = BareModifierTrigger(rawValue: rawTrigger) else {
        throw BridgeError("invalid-params", "mac.input.syntheticBareModifier requires modifier DoubleCommand, DoubleOption, or DoubleShift.")
    }
    let result = try postSyntheticBareModifier(
        trigger: trigger,
        holdMilliseconds: readSyntheticHoldMilliseconds(
            params: params,
            method: "mac.input.syntheticBareModifier"
        )
    )
    return [
        "trigger": trigger.rawValue,
        "modifier": trigger.rawValue,
        "holdMilliseconds": result.holdMilliseconds,
        "postedEventCount": result.postedEventCount,
        "postedAt": result.postedAt,
    ]
}

func readSyntheticHoldMilliseconds(params: [String: Any], method: String) throws -> Double {
    let holdMilliseconds = (params["holdMilliseconds"] as? NSNumber)?.doubleValue ?? 120
    guard holdMilliseconds >= 20, holdMilliseconds <= 1_000 else {
        throw BridgeError("invalid-params", "\(method) requires holdMilliseconds between 20 and 1000.")
    }
    return holdMilliseconds
}

func postSyntheticBareModifier(
    trigger: BareModifierTrigger,
    holdMilliseconds: Double
) throws -> (holdMilliseconds: Double, postedEventCount: Int, postedAt: String) {
    let source = CGEventSource(stateID: .hidSystemState)
    let leftFlag = trigger.leftDeviceFlag
    let rightFlag = trigger.rightDeviceFlag
    let modifierFlag = trigger.modifierFlag.rawValue
    let events: [(keyCode: CGKeyCode, keyDown: Bool, flags: UInt64, delayMilliseconds: Double)] = [
        (trigger.leftKeyCode, true, leftFlag | modifierFlag, 0),
        (trigger.rightKeyCode, true, leftFlag | rightFlag | modifierFlag, 35),
        (trigger.rightKeyCode, false, leftFlag | modifierFlag, holdMilliseconds),
        (trigger.leftKeyCode, false, 0, 35),
    ]

    for eventSpec in events {
        if eventSpec.delayMilliseconds > 0 {
            Thread.sleep(forTimeInterval: eventSpec.delayMilliseconds / 1_000)
        }
        guard let event = CGEvent(
            keyboardEventSource: source,
            virtualKey: eventSpec.keyCode,
            keyDown: eventSpec.keyDown
        ) else {
            throw BridgeError("synthetic-input-unavailable", "Mac Bridge could not create a synthetic bare modifier event.")
        }
        event.flags = CGEventFlags(rawValue: eventSpec.flags)
        event.setIntegerValueField(.keyboardEventKeycode, value: Int64(eventSpec.keyCode))
        event.post(tap: .cghidEventTap)
    }

    return (
        holdMilliseconds: holdMilliseconds,
        postedEventCount: events.count,
        postedAt: isoTimestamp()
    )
}

func captureFrontmostWindow(params: [String: Any], feedbackPresenter: FeedbackIndicatorPresenter) throws -> [String: Any] {
    guard let outputDir = params["outputDir"] as? String, !outputDir.isEmpty else {
        throw BridgeError("invalid-params", "mac.capture.frontmostWindow requires outputDir.")
    }

    do {
        let window = try readCaptureWindow(params: params)
        try enforcePrivacyRules(window: window, params: params)

        let fileManager = FileManager.default
        try fileManager.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

        let captureId = "capture-\(Int(Date().timeIntervalSince1970 * 1000))-\(window.windowId)"
        let filePath = (outputDir as NSString).appendingPathComponent("\(captureId).png")
        let metadataPath = (outputDir as NSString).appendingPathComponent("\(captureId).json")
        let captureResult = try captureWindowImage(window: window, filePath: filePath)

        let capturedAt = isoTimestamp()
        var metadata: [String: Any] = [
            "filePath": filePath,
            "metadataPath": metadataPath,
            "capturedAt": capturedAt,
            "captureBackend": captureResult.backend,
            "window": serialize(window: window),
        ]
        if let screenCaptureKitError = captureResult.screenCaptureKitError {
            metadata["screenCaptureKitError"] = screenCaptureKitError
        }
        let metadataData = try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
        try metadataData.write(to: URL(fileURLWithPath: metadataPath), options: [.atomic])

        feedbackPresenter.show(.success(
            label: "Screenshot captured",
            detail: (filePath as NSString).lastPathComponent,
            icon: .camera,
            targetWindowBounds: window.bounds,
            revealFilePath: filePath
        ))

        return metadata
    } catch let error as BridgeError {
        feedbackPresenter.show(.failure(label: "Screenshot failed", detail: error.message, icon: .camera))
        throw error
    } catch {
        feedbackPresenter.show(.failure(label: "Screenshot failed", detail: "\(error)", icon: .camera))
        throw error
    }
}

func captureAppshotFrontmostWindow(params: [String: Any], appshotTransitionPresenter: AppshotTransitionPresenter) throws -> [String: Any] {
    guard let outputDir = params["outputDir"] as? String, !outputDir.isEmpty else {
        throw BridgeError("invalid-params", "mac.appshot.captureFrontmostWindow requires outputDir.")
    }

    let window = try readCaptureWindow(params: params)
    try enforcePrivacyRules(window: window, params: params)

    let fileManager = FileManager.default
    try fileManager.createDirectory(atPath: outputDir, withIntermediateDirectories: true)

    let captureId = "appshot-\(Int(Date().timeIntervalSince1970 * 1000))-\(window.windowId)"
    let filePath = (outputDir as NSString).appendingPathComponent("\(captureId).png")
    let transitionSnapshotPath = (outputDir as NSString).appendingPathComponent("\(captureId)-transition.png")
    let metadataPath = (outputDir as NSString).appendingPathComponent("\(captureId).json")
    let captureResult = try captureWindowImage(window: window, filePath: filePath)
    let captureImageSize = readCaptureImageSize(filePath: filePath)
    let target = AppshotTransitionTarget.from(
        params: params,
        fallbackWindowBounds: window.bounds,
        captureImageSize: captureImageSize
    )
    let calibration = AppshotTransitionCalibration.from(
        params: params,
        target: target,
        windowTitle: window.title,
        appName: window.appName
    )
    let appshotDisplayTitle = readAppshotDisplayTitle(windowTitle: window.title, appName: window.appName)
    try writeAppshotTransitionSnapshotImage(
        screenshotPath: filePath,
        outputPath: transitionSnapshotPath,
        snapshotHeight: CGFloat(calibration.transitionSnapshotHeight ?? AppshotLayerMetrics.transitionSnapshotBaseHeight),
        scale: max(target.transitionSnapshotScale, 1)
    )
    let transitionSnapshotImageSize = readCaptureImageSize(filePath: transitionSnapshotPath)
    let transition = appshotTransitionPresenter.present(
        screenshotPath: filePath,
        transitionSnapshotPath: transitionSnapshotPath,
        transitionSnapshotImageSize: transitionSnapshotImageSize,
        sourceWindow: window,
        target: target,
        calibration: calibration,
        appTitle: appshotDisplayTitle,
        bundleIdentifier: window.bundleId,
        soundEnabled: (params["soundEnabled"] as? Bool) ?? true
    )

    let capturedAt = isoTimestamp()
    var metadata: [String: Any] = [
        "filePath": filePath,
        "metadataPath": metadataPath,
        "capturedAt": capturedAt,
        "captureBackend": captureResult.backend,
        "captureImageSize": captureImageSize?.serialize() ?? NSNull(),
        "window": serialize(window: window),
        "appshot": transition.serialize(),
    ]
    if let screenCaptureKitError = captureResult.screenCaptureKitError {
        metadata["screenCaptureKitError"] = screenCaptureKitError
    }
    let metadataData = try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
    try metadataData.write(to: URL(fileURLWithPath: metadataPath), options: [.atomic])

    return metadata
}

func readAppshotDisplayTitle(windowTitle: String?, appName: String?) -> String? {
    let trimmedWindowTitle = windowTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let trimmedWindowTitle, !trimmedWindowTitle.isEmpty {
        return trimmedWindowTitle
    }
    let trimmedAppName = appName?.trimmingCharacters(in: .whitespacesAndNewlines)
    if let trimmedAppName, !trimmedAppName.isEmpty {
        return trimmedAppName
    }
    return nil
}

func writeAppshotTransitionSnapshotImage(
    screenshotPath: String,
    outputPath: String,
    snapshotHeight: CGFloat,
    scale: CGFloat
) throws {
    guard let screenshot = NSImage(contentsOfFile: screenshotPath) else {
        throw BridgeError("appshot-transition-snapshot-source-unavailable", "Could not read Appshot screenshot for transition snapshot.", details: [
            "screenshotPath": screenshotPath,
        ])
    }

    let pointSize = NSSize(
        width: AppshotLayerMetrics.transitionSnapshotBaseWidth,
        height: max(snapshotHeight, 1)
    )
    let pixelSize = NSSize(
        width: max(ceil(pointSize.width * scale), 1),
        height: max(ceil(pointSize.height * scale), 1)
    )
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: Int(pixelSize.width),
        pixelsHigh: Int(pixelSize.height),
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bitmapFormat: [.alphaFirst],
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw BridgeError("appshot-transition-snapshot-bitmap-unavailable", "Could not allocate Appshot transition snapshot bitmap.")
    }
    bitmap.size = pointSize

    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw BridgeError("appshot-transition-snapshot-context-unavailable", "Could not create Appshot transition snapshot graphics context.")
    }

    let snapshotBodyBounds = CGRect(
        x: 0,
        y: 0,
        width: pointSize.width,
        height: min(CGFloat(AppshotLayerMetrics.transitionSnapshotBaseHeight), pointSize.height)
    )
    let drawRect = aspectFitRect(
        sourceSize: screenshot.size,
        targetBounds: snapshotBodyBounds,
        verticalAlignment: .center
    )

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    NSColor.clear.setFill()
    NSRect(origin: .zero, size: pointSize).fill()
    screenshot.draw(
        in: drawRect,
        from: NSRect(origin: .zero, size: screenshot.size),
        operation: .copy,
        fraction: 1,
        respectFlipped: false,
        hints: [.interpolation: NSImageInterpolation.high]
    )
    NSGraphicsContext.restoreGraphicsState()

    guard let data = bitmap.representation(using: NSBitmapImageRep.FileType.png, properties: [:]) else {
        throw BridgeError("appshot-transition-snapshot-png-unavailable", "Could not encode Appshot transition snapshot PNG.")
    }
    try data.write(to: URL(fileURLWithPath: outputPath), options: Data.WritingOptions.atomic)
}

func readAppshotFrontmostContext() throws -> [String: Any] {
    let window = try readFrontmostWindow()
    return readAppshotContext(window: window)
}

func readAppshotContextForWindow(params: [String: Any]) throws -> [String: Any] {
    guard let target = try readWindowTarget(raw: params["targetWindow"]) else {
        throw BridgeError("invalid-params", "mac.appshot.contextForWindow requires targetWindow.")
    }
    let window = try readTargetWindow(target: target)
    return readAppshotContext(window: window)
}

func readAppshotContext(window: WindowCandidate) -> [String: Any] {
    let target = AppshotTransitionTarget.from(params: [:], fallbackWindowBounds: window.bounds)
    return [
        "window": serialize(window: window),
        "bundleIdentifier": window.bundleId ?? NSNull(),
        "animationTarget": serialize(target: target),
    ]
}

func readAppshotWindowInventory() throws -> [String: Any] {
    let windows = try readRawWindowInventory().compactMap { raw in
        readWindowCandidate(raw: raw, application: nil)
    }
    return [
        "windows": windows.map(serializeWindowInventoryItem),
    ]
}

func serializeWindowInventoryItem(window: WindowCandidate) -> [String: Any] {
    var payload: [String: Any] = [
        "windowId": window.windowId,
        "appName": window.appName ?? NSNull(),
        "bundleId": window.bundleId ?? NSNull(),
        "processId": window.processId,
        "title": window.title ?? NSNull(),
        "bounds": window.bounds ?? NSNull(),
    ]
    if let frameEvidence = window.frameEvidence {
        payload["frameEvidence"] = serialize(frameEvidence: frameEvidence)
    }
    return payload
}

func probeAppshotTransitionVisibility(params: [String: Any], appshotTransitionPresenter: AppshotTransitionPresenter) throws -> [String: Any] {
    guard let outputDir = params["outputDir"] as? String, !outputDir.isEmpty else {
        throw BridgeError("invalid-params", "mac.appshot.probeTransitionVisibility requires outputDir.")
    }
    guard let screenshotPath = params["screenshotPath"] as? String, !screenshotPath.isEmpty else {
        throw BridgeError("invalid-params", "mac.appshot.probeTransitionVisibility requires screenshotPath.")
    }
    guard FileManager.default.fileExists(atPath: screenshotPath) else {
        throw BridgeError("invalid-params", "mac.appshot.probeTransitionVisibility screenshotPath does not exist.", details: [
            "screenshotPath": screenshotPath,
        ])
    }

    let fallbackWindowBounds = readProbeWindowBounds(raw: params["sourceWindow"])
    let target = AppshotTransitionTarget.from(
        params: params,
        fallbackWindowBounds: fallbackWindowBounds,
        captureImageSize: readCaptureImageSize(filePath: screenshotPath)
    )
    let sampleCount = max(readInteger(params["sampleCount"]) ?? 12, 1)
    let sampleIntervalSeconds = readPositiveProbeDouble(params["sampleIntervalSeconds"]) ?? 0.2
    let captureImages = (params["captureImages"] as? Bool) ?? true
    let sourceWindow = params["sourceWindow"] as? [String: Any]
    let calibration = AppshotTransitionCalibration.from(
        params: params,
        target: target,
        windowTitle: sourceWindow?["title"] as? String,
        appName: sourceWindow?["appName"] as? String
    )
    let appshotDisplayTitle = readAppshotDisplayTitle(
        windowTitle: sourceWindow?["title"] as? String,
        appName: sourceWindow?["appName"] as? String
    )

    return try appshotTransitionPresenter.probeVisibility(
        screenshotPath: screenshotPath,
        outputDir: outputDir,
        target: target,
        calibration: calibration,
        appTitle: appshotDisplayTitle,
        bundleIdentifier: sourceWindow?["bundleId"] as? String,
        sampleCount: sampleCount,
        sampleIntervalSeconds: sampleIntervalSeconds,
        captureImages: captureImages
    )
}

func probeAppshotTransitionPresentation(params: [String: Any], appshotTransitionPresenter: AppshotTransitionPresenter) throws -> [String: Any] {
    guard let outputDir = params["outputDir"] as? String, !outputDir.isEmpty else {
        throw BridgeError("invalid-params", "mac.appshot.probeTransitionPresentation requires outputDir.")
    }
    guard let screenshotPath = params["screenshotPath"] as? String, !screenshotPath.isEmpty else {
        throw BridgeError("invalid-params", "mac.appshot.probeTransitionPresentation requires screenshotPath.")
    }
    guard FileManager.default.fileExists(atPath: screenshotPath) else {
        throw BridgeError("invalid-params", "mac.appshot.probeTransitionPresentation screenshotPath does not exist.", details: [
            "screenshotPath": screenshotPath,
        ])
    }
    let transitionSnapshotPath = params["transitionSnapshotPath"] as? String

    let fallbackWindowBounds = readProbeWindowBounds(raw: params["sourceWindow"])
    let target = AppshotTransitionTarget.from(
        params: params,
        fallbackWindowBounds: fallbackWindowBounds,
        captureImageSize: readCaptureImageSize(filePath: screenshotPath)
    )
    let sampleCount = max(readInteger(params["sampleCount"]) ?? 16, 1)
    let sampleIntervalSeconds = readPositiveProbeDouble(params["sampleIntervalSeconds"]) ?? 0.06
    let renderImages = (params["renderImages"] as? Bool) ?? true
    let sourceWindow = params["sourceWindow"] as? [String: Any]
    let calibration = AppshotTransitionCalibration.from(
        params: params,
        target: target,
        windowTitle: sourceWindow?["title"] as? String,
        appName: sourceWindow?["appName"] as? String
    )
    let appshotDisplayTitle = readAppshotDisplayTitle(
        windowTitle: sourceWindow?["title"] as? String,
        appName: sourceWindow?["appName"] as? String
    )

    return try appshotTransitionPresenter.probePresentation(
        screenshotPath: screenshotPath,
        transitionSnapshotPath: transitionSnapshotPath,
        outputDir: outputDir,
        target: target,
        calibration: calibration,
        appTitle: appshotDisplayTitle,
        bundleIdentifier: sourceWindow?["bundleId"] as? String,
        sampleCount: sampleCount,
        sampleIntervalSeconds: sampleIntervalSeconds,
        renderImages: renderImages
    )
}

func readPositiveProbeDouble(_ raw: Any?) -> Double? {
    if let number = raw as? NSNumber {
        let value = number.doubleValue
        return value.isFinite && value > 0 ? value : nil
    }
    if let value = raw as? Double {
        return value.isFinite && value > 0 ? value : nil
    }
    return nil
}

func readProbeWindowBounds(raw: Any?) -> [String: Double]? {
    guard let rawWindow = raw as? [String: Any] else {
        return nil
    }
    if let bounds = rawWindow["bounds"] as? [String: Any] {
        return [
            "x": (bounds["x"] as? NSNumber)?.doubleValue ?? 0,
            "y": (bounds["y"] as? NSNumber)?.doubleValue ?? 0,
            "width": (bounds["width"] as? NSNumber)?.doubleValue ?? 0,
            "height": (bounds["height"] as? NSNumber)?.doubleValue ?? 0,
        ]
    }
    return nil
}

func readCaptureWindow(params: [String: Any]) throws -> WindowCandidate {
    if let target = try readWindowTarget(raw: params["targetWindow"]) {
        return try readTargetWindow(target: target)
    }
    return try readFrontmostWindow()
}

func readWindowTarget(raw: Any?) throws -> WindowTarget? {
    guard let raw else {
        return nil
    }
    guard let payload = raw as? [String: Any] else {
        throw BridgeError("invalid-params", "targetWindow must be an object.")
    }
    guard let windowId = readInteger(payload["windowId"]) else {
        throw BridgeError("invalid-params", "targetWindow.windowId is required.")
    }
    return WindowTarget(
        windowId: windowId,
        processId: readInteger(payload["processId"]),
        bundleId: (payload["bundleId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    )
}

func readFrontmostWindow() throws -> WindowCandidate {
    guard let app = NSWorkspace.shared.frontmostApplication else {
        throw BridgeError("frontmost-app-unavailable", "No frontmost application is available.")
    }
    if isCradleApplication(application: app) {
        guard let lastWindow = frontmostWindowTracker.readLastWindow() else {
            throw BridgeError("source-window-unavailable", "No previous non-Cradle source window is available for Appshot capture.")
        }
        return try readTargetWindow(target: WindowTarget(
            windowId: lastWindow.windowId,
            processId: lastWindow.processId,
            bundleId: lastWindow.bundleId
        ))
    }
    return try readWindowForApplication(app)
}

func readWindowForApplication(_ app: NSRunningApplication) throws -> WindowCandidate {
    let pid = Int(app.processIdentifier)
    let rawWindows = try readRawWindowInventory()
    let accessibilityWindow = readAccessibilityWindowSnapshot(application: app)

    let frontmostCandidates = rawWindows.compactMap { raw -> WindowCandidate? in
        guard let ownerPid = readInteger(raw[kCGWindowOwnerPID as String]), ownerPid == pid else {
            return nil
        }
        return readWindowCandidate(raw: raw, application: app, accessibilityWindow: accessibilityWindow)
    }
    if let selected = selectWindowCandidate(candidates: frontmostCandidates, accessibilityWindow: accessibilityWindow) {
        return selected
    }

    var details = [
        "processId": String(pid),
    ]
    if let bundleId = app.bundleIdentifier {
        details["bundleId"] = bundleId
    }
    throw BridgeError("frontmost-window-unavailable", "No capturable frontmost window was found for the frontmost application.", details: details)
}

func isCradleApplication(application: NSRunningApplication) -> Bool {
    guard let bundleIdentifier = application.bundleIdentifier else {
        return false
    }
    return cradleApplicationBundleIdentifiers.contains(bundleIdentifier)
}

func selectWindowCandidate(candidates: [WindowCandidate], accessibilityWindow: AccessibilityWindowSnapshot?) -> WindowCandidate? {
    guard !candidates.isEmpty else {
        return nil
    }
    guard let accessibilityWindow else {
        return candidates.first
    }

    let ranked = candidates.enumerated().map { index, candidate in
        (candidate: candidate, index: index, score: scoreWindowCandidate(candidate, accessibilityWindow: accessibilityWindow))
    }.sorted { left, right in
        if left.score == right.score {
            return left.index < right.index
        }
        return left.score > right.score
    }
    return ranked.first?.candidate ?? candidates.first
}

func scoreWindowCandidate(_ candidate: WindowCandidate, accessibilityWindow: AccessibilityWindowSnapshot) -> Double {
    var score = 0.0
    if let candidateTitle = candidate.title?.trimmingCharacters(in: .whitespacesAndNewlines),
       let accessibilityTitle = accessibilityWindow.title?.trimmingCharacters(in: .whitespacesAndNewlines),
       !candidateTitle.isEmpty,
       !accessibilityTitle.isEmpty {
        if candidateTitle == accessibilityTitle {
            score += 100
        } else if candidateTitle.contains(accessibilityTitle) || accessibilityTitle.contains(candidateTitle) {
            score += 40
        }
    }
    if let candidateBounds = readCGRect(candidate.bounds),
       let accessibilityFrame = accessibilityWindow.frame {
        let widthDelta = abs(candidateBounds.width - accessibilityFrame.width)
        let heightDelta = abs(candidateBounds.height - accessibilityFrame.height)
        if widthDelta <= 8 && heightDelta <= 8 {
            score += 30
        }
        let originDelta = hypot(candidateBounds.midX - accessibilityFrame.midX, candidateBounds.midY - accessibilityFrame.midY)
        if originDelta <= 24 {
            score += 40
        } else if widthDelta <= 8 && heightDelta <= 8 {
            score += 10
        }
    }
    return score
}

func windowCandidateWithAccessibilityFrame(_ candidate: WindowCandidate, accessibilityWindow: AccessibilityWindowSnapshot?) -> WindowCandidate {
    guard let accessibilityFrame = accessibilityWindow?.frame,
          let coreGraphicsFrame = readCGRect(candidate.bounds),
          isLikelySameWindow(coreGraphicsFrame, accessibilityFrame) else {
        return candidate
    }
    return WindowCandidate(
        windowId: candidate.windowId,
        appName: candidate.appName,
        bundleId: candidate.bundleId,
        processId: candidate.processId,
        title: candidate.title,
        bounds: serialize(rect: accessibilityFrame),
        axTree: accessibilityWindow?.axTree ?? candidate.axTree,
        frameEvidence: WindowFrameEvidence(
            coreGraphicsBounds: candidate.bounds,
            accessibilityFrame: accessibilityFrame
        )
    )
}

func isLikelySameWindow(_ lhs: CGRect, _ rhs: CGRect) -> Bool {
    let sizeDelta = abs(lhs.width - rhs.width) + abs(lhs.height - rhs.height)
    let centerDelta = hypot(lhs.midX - rhs.midX, lhs.midY - rhs.midY)
    return sizeDelta <= 96 && centerDelta <= 96
}

func readAccessibilityWindowSnapshot(application: NSRunningApplication) -> AccessibilityWindowSnapshot? {
    let applicationElement = AXUIElementCreateApplication(application.processIdentifier)
    let windowElement = readAXWindowElement(applicationElement, attribute: kAXFocusedWindowAttribute)
        ?? readAXWindowElement(applicationElement, attribute: kAXMainWindowAttribute)
    guard let windowElement else {
        return nil
    }
    return AccessibilityWindowSnapshot(
        title: readAXString(windowElement, attribute: kAXTitleAttribute),
        frame: readAXFrame(windowElement),
        axTree: readAXTreeText(windowElement)
    )
}

func readAXWindowElement(_ element: AXUIElement, attribute: String) -> AXUIElement? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let value, CFGetTypeID(value) == AXUIElementGetTypeID() else {
        return nil
    }
    return (value as! AXUIElement)
}

func readAXString(_ element: AXUIElement, attribute: String) -> String? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success else {
        return nil
    }
    return value as? String
}

func readAXTreeText(_ root: AXUIElement) -> String? {
    var lines: [String] = []
    var visited = Set<UInt>()
    appendAXTreeText(root, depth: 0, lines: &lines, visited: &visited)
    let text = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    return text.isEmpty ? nil : text
}

func appendAXTreeText(_ element: AXUIElement, depth: Int, lines: inout [String], visited: inout Set<UInt>) {
    let maxDepth = 5
    let maxLines = 180
    guard depth <= maxDepth, lines.count < maxLines else {
        return
    }

    let elementId = UInt(bitPattern: Unmanaged.passUnretained(element).toOpaque())
    if visited.contains(elementId) {
        return
    }
    visited.insert(elementId)

    let parts = [
        readAXString(element, attribute: kAXRoleAttribute),
        readAXString(element, attribute: kAXSubroleAttribute),
        readAXString(element, attribute: kAXTitleAttribute),
        readAXString(element, attribute: kAXDescriptionAttribute),
        readAXString(element, attribute: kAXValueAttribute),
    ].compactMap { value -> String? in
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    if !parts.isEmpty {
        lines.append("\(String(repeating: "  ", count: depth))\(parts.joined(separator: " | "))")
    }

    guard let children = readAXChildren(element) else {
        return
    }
    for child in children.prefix(80) {
        appendAXTreeText(child, depth: depth + 1, lines: &lines, visited: &visited)
        if lines.count >= maxLines {
            break
        }
    }
}

func readAXChildren(_ element: AXUIElement) -> [AXUIElement]? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value)
    guard result == .success,
          let value,
          CFGetTypeID(value) == CFArrayGetTypeID() else {
        return nil
    }
    return (value as! [Any]).compactMap { child in
        guard CFGetTypeID(child as CFTypeRef) == AXUIElementGetTypeID() else {
            return nil
        }
        return (child as! AXUIElement)
    }
}

func readAXFrame(_ element: AXUIElement) -> CGRect? {
    guard let position = readAXCGPoint(element, attribute: kAXPositionAttribute),
          let size = readAXCGSize(element, attribute: kAXSizeAttribute),
          size.width > 0,
          size.height > 0 else {
        return nil
    }
    return CGRect(origin: position, size: size)
}

func readAXCGPoint(_ element: AXUIElement, attribute: String) -> CGPoint? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let value, CFGetTypeID(value) == AXValueGetTypeID() else {
        return nil
    }
    let axValue = value as! AXValue
    guard AXValueGetType(axValue) == .cgPoint else {
        return nil
    }
    var point = CGPoint.zero
    guard AXValueGetValue(axValue, .cgPoint, &point) else {
        return nil
    }
    return point
}

func readAXCGSize(_ element: AXUIElement, attribute: String) -> CGSize? {
    var value: CFTypeRef?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    guard result == .success, let value, CFGetTypeID(value) == AXValueGetTypeID() else {
        return nil
    }
    let axValue = value as! AXValue
    guard AXValueGetType(axValue) == .cgSize else {
        return nil
    }
    var size = CGSize.zero
    guard AXValueGetValue(axValue, .cgSize, &size) else {
        return nil
    }
    return size
}

func readTargetWindow(target: WindowTarget) throws -> WindowCandidate {
    let rawWindows = try readRawWindowInventory()
    let matchingWindows = rawWindows.compactMap { raw -> WindowCandidate? in
        readWindowCandidate(raw: raw, application: nil)
    }.filter { candidate in
        if candidate.windowId != target.windowId {
            return false
        }
        if let processId = target.processId, candidate.processId != processId {
            return false
        }
        if let bundleId = target.bundleId, candidate.bundleId != bundleId {
            return false
        }
        return true
    }
    guard let selected = matchingWindows.first else {
        var details = [
            "windowId": String(target.windowId),
        ]
        if let processId = target.processId {
            details["processId"] = String(processId)
        }
        if let bundleId = target.bundleId {
            details["bundleId"] = bundleId
        }
        throw BridgeError("target-window-unavailable", "The requested target window is no longer capturable.", details: details)
    }
    let accessibilityWindow = NSRunningApplication(processIdentifier: pid_t(selected.processId))
        .flatMap { readAccessibilityWindowSnapshot(application: $0) }
    return windowCandidateWithAccessibilityFrame(selected, accessibilityWindow: accessibilityWindow)
}

func readRawWindowInventory() throws -> [[String: Any]] {
    let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let rawWindows = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else {
        throw BridgeError("window-inventory-unavailable", "CoreGraphics did not return a window inventory.")
    }
    return rawWindows
}

func readWindowCandidate(
    raw: [String: Any],
    application: NSRunningApplication?,
    accessibilityWindow: AccessibilityWindowSnapshot? = nil
) -> WindowCandidate? {
    guard let ownerPid = readInteger(raw[kCGWindowOwnerPID as String]),
          let layer = readInteger(raw[kCGWindowLayer as String]), layer == 0,
          let windowId = readInteger(raw[kCGWindowNumber as String])
    else {
        return nil
    }
    let bounds = readBounds(raw[kCGWindowBounds as String])
    if let bounds, (bounds["width"] ?? 0) <= 1 || (bounds["height"] ?? 0) <= 1 {
        return nil
    }
    let ownerApplication = application ?? NSRunningApplication(processIdentifier: pid_t(ownerPid))
    let candidate = WindowCandidate(
        windowId: windowId,
        appName: ownerApplication?.localizedName ?? raw[kCGWindowOwnerName as String] as? String,
        bundleId: ownerApplication?.bundleIdentifier,
        processId: ownerPid,
        title: raw[kCGWindowName as String] as? String,
        bounds: bounds,
        axTree: accessibilityWindow?.axTree,
        frameEvidence: WindowFrameEvidence(
            coreGraphicsBounds: bounds,
            accessibilityFrame: nil
        )
    )
    return windowCandidateWithAccessibilityFrame(candidate, accessibilityWindow: accessibilityWindow)
}

func readInteger(_ raw: Any?) -> Int? {
    if let value = raw as? Int {
        return value
    }
    if let value = raw as? NSNumber {
        return value.intValue
    }
    return nil
}

func readBounds(_ raw: Any?) -> [String: Double]? {
    guard let raw = raw as? [String: Any] else {
        return nil
    }
    return [
        "x": (raw["X"] as? NSNumber)?.doubleValue ?? 0,
        "y": (raw["Y"] as? NSNumber)?.doubleValue ?? 0,
        "width": (raw["Width"] as? NSNumber)?.doubleValue ?? 0,
        "height": (raw["Height"] as? NSNumber)?.doubleValue ?? 0,
    ]
}

func readCGRect(_ raw: [String: Double]?) -> CGRect? {
    guard let raw,
          let x = raw["x"],
          let y = raw["y"],
          let width = raw["width"],
          let height = raw["height"],
          width > 0,
          height > 0 else {
        return nil
    }
    return CGRect(x: x, y: y, width: width, height: height)
}

func enforcePrivacyRules(window: WindowCandidate, params: [String: Any]) throws {
    let bundleIds = params["privacySensitiveAppBundleIds"] as? [String] ?? []
    if let bundleId = window.bundleId, bundleIds.contains(bundleId) {
        throw BridgeError("privacy-sensitive-window", "Capture blocked by privacy-sensitive app rule.", details: [
            "bundleId": bundleId,
        ])
    }

    let titlePatterns = params["privacySensitiveTitlePatterns"] as? [String] ?? []
    if let title = window.title {
        for pattern in titlePatterns where !pattern.isEmpty {
            if title.range(of: pattern, options: [.caseInsensitive, .diacriticInsensitive]) != nil {
                throw BridgeError("privacy-sensitive-window", "Capture blocked by privacy-sensitive title rule.", details: [
                    "pattern": pattern,
                ])
            }
        }
    }
}

func runScreenCapture(windowId: Int, filePath: String) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    process.arguments = ["-x", "-l", String(windowId), filePath]
    let stderr = Pipe()
    process.standardError = stderr

    try process.run()
    process.waitUntilExit()

    if process.terminationStatus != 0 {
        let data = stderr.fileHandleForReading.readDataToEndOfFile()
        let message = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        throw BridgeError("screen-capture-failed", message?.isEmpty == false ? message! : "screencapture failed.")
    }
    if !FileManager.default.fileExists(atPath: filePath) {
        throw BridgeError("screen-capture-missing-output", "screencapture finished without writing the output file.")
    }
}

func serialize(window: WindowCandidate) -> [String: Any] {
    var payload: [String: Any] = [
        "windowId": window.windowId,
        "appName": window.appName ?? NSNull(),
        "bundleId": window.bundleId ?? NSNull(),
        "appIconDataUrl": readApplicationIconDataURL(window: window) ?? NSNull(),
        "processId": window.processId,
        "title": window.title ?? NSNull(),
        "bounds": window.bounds ?? NSNull(),
        "axTree": window.axTree ?? NSNull(),
    ]
    if let frameEvidence = window.frameEvidence {
        payload["frameEvidence"] = serialize(frameEvidence: frameEvidence)
    }
    return payload
}

func serialize(frameEvidence: WindowFrameEvidence) -> [String: Any] {
    [
        "coreGraphicsBounds": frameEvidence.coreGraphicsBounds ?? NSNull(),
        "accessibilityFrame": frameEvidence.accessibilityFrame.map { serialize(rect: $0) } ?? NSNull(),
    ]
}

func readApplicationIconDataURL(window: WindowCandidate) -> String? {
    let application = NSRunningApplication(processIdentifier: pid_t(window.processId))
        ?? window.bundleId.flatMap { bundleIdentifier in
            NSRunningApplication
                .runningApplications(withBundleIdentifier: bundleIdentifier)
                .first(where: { !$0.isTerminated })
    }
    guard let icon = application?.icon,
          let pngData = renderApplicationIconPNGData(icon: icon, size: 64)
    else {
        return nil
    }
    return "data:image/png;base64,\(pngData.base64EncodedString())"
}

func renderApplicationIconPNGData(icon: NSImage, size: CGFloat) -> Data? {
    let pixelSize = max(Int(size), 1)
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixelSize,
        pixelsHigh: pixelSize,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bitmapFormat: [],
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        return nil
    }
    bitmap.size = NSSize(width: size, height: size)
    guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        return nil
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    NSColor.clear.setFill()
    NSRect(x: 0, y: 0, width: size, height: size).fill()
    icon.draw(
        in: NSRect(x: 0, y: 0, width: size, height: size),
        from: .zero,
        operation: .copy,
        fraction: 1,
        respectFlipped: false,
        hints: [.interpolation: NSImageInterpolation.high]
    )
    NSGraphicsContext.restoreGraphicsState()
    return bitmap.representation(using: .png, properties: [:])
}

func serialize(target: AppshotTransitionTarget) -> [String: Any] {
    [
        "coordinateSpace": target.coordinateSpace,
        "codexDisplay": [
            "id": target.displayMapping.displayId ?? displayIdentifier(for: target.displayFrame),
            "scaleFactor": Double(target.displayScaleFactor),
            "bounds": serialize(rect: target.displayFrame),
            "workArea": serialize(rect: target.displayWorkArea),
        ],
        "destinationBackgroundColor": hexColor(target.destinationBackgroundColor),
        "destinationCornerRadius": Double(target.destinationCornerRadius),
        "destinationFrame": serialize(rect: target.destinationFrame),
        "destinationPrimaryTextColor": hexColor(target.destinationPrimaryTextColor),
        "transitionSnapshotScale": Double(target.transitionSnapshotScale),
    ]
}

func serialize(rect: CGRect) -> [String: Double] {
    [
        "x": Double(rect.origin.x),
        "y": Double(rect.origin.y),
        "width": Double(rect.size.width),
        "height": Double(rect.size.height),
    ]
}

func displayIdentifier(for frame: CGRect) -> Int {
    guard let screen = NSScreen.screens.first(where: { $0.frame == frame || $0.frame.intersects(frame) }) else {
        return 0
    }
    return (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.intValue ?? 0
}

func hexColor(_ color: NSColor) -> String {
    let converted = color.usingColorSpace(.sRGB) ?? color
    let red = Int(round(max(0, min(converted.redComponent, 1)) * 255))
    let green = Int(round(max(0, min(converted.greenComponent, 1)) * 255))
    let blue = Int(round(max(0, min(converted.blueComponent, 1)) * 255))
    return String(format: "#%02x%02x%02x", red, green, blue)
}

func isoTimestamp() -> String {
    ISO8601DateFormatter().string(from: Date())
}

let runtime = BridgeRuntime()
runtime.run()
