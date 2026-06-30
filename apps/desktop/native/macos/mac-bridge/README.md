# Cradle Mac Bridge

Desktop-owned Swift sidecar for macOS APIs that are awkward or unsafe to call from Electron renderer code.

## Files

- `Package.swift`: Swift package manifest for the `cradle-mac-bridge` executable.
- `Resources/Appshot.wav`: Cradle-owned packaged Appshot capture sound copied from the researched Codex Appshot resource for parity work.
- `Sources/CradleMacBridge/AppshotTransitionPresenter.swift`: AppKit and Core Animation Appshot overlay presenter with background, shutter, snapshot, mask, shadow, icon, title transition layers, CoreGraphics visibility probe, and native presentation-frame probe.
- `Sources/CradleMacBridge/FeedbackIndicatorPresenter.swift`: Reusable AppKit top-center feedback indicator used by native bridge actions after success or failure.
- `Sources/CradleMacBridge/ScreenCaptureKitDisplayRecorder.swift`: Two-phase recording backend for Appshot parity evidence; it supports ScreenCaptureKit window-discovery streams, ScreenCaptureKit display streams, and CoreGraphics display polling fallback when ScreenCaptureKit cannot enumerate displays.
- `Sources/CradleMacBridge/ScreenCaptureKitWindowCapture.swift`: ScreenCaptureKit-first window capture backend with `screencapture` fallback.
- `Sources/CradleMacBridge/main.swift`: NDJSON protocol server, permission status checks, both-Command input monitor, frontmost window inventory, Appshot capture orchestration, and legacy window screenshot capture.

## Protocol

The bridge reads newline-delimited JSON from stdin and writes newline-delimited JSON to stdout. Requests include `id`, `method`, and optional `params`. Responses include the same `id` and either `result` or `error`.

Supported methods:

- `bridge.status`: Returns bridge name, version, pid, and platform.
- `mac.permissions.status`: Returns Accessibility, Screen Recording, and Input Monitoring status.
- `mac.permissions.request`: Asks macOS to show permission prompts for Accessibility, Screen Recording, and Input Monitoring.
- `mac.permissions.openSettings`: Opens the relevant Privacy & Security pane in System Settings.
- `mac.input.configure`: Enables or disables the selected bare-modifier trigger (`DoubleCommand`, `DoubleOption`, or `DoubleShift`).
- `mac.input.syntheticBothCommand`: Explicit parity-test helper that posts public CGEvent both-Command key down/up events. It is opt-in, intended for Codex-vs-Cradle Appshot recording automation, and does not call Codex private Apple Event protocols.
- `mac.capture.frontmostWindow`: Captures the current frontmost window, or an explicit `targetWindow` selected by `windowId` plus optional `processId` and `bundleId`, to the provided output directory and shows a native top-center feedback indicator on the captured window's screen.
- `mac.appshot.captureFrontmostWindow`: Captures the current frontmost window, or an explicit `targetWindow` selected by `windowId` plus optional `processId` and `bundleId`, writes Cradle-owned Appshot artifacts, and presents the native Appshot transition overlay.
- `mac.appshot.probeTransitionVisibility`: Replays the native Appshot overlay with an existing screenshot, records whether CoreGraphics can enumerate the overlay panel, and attempts external `CGWindowListCreateImage` proof samples.
- `mac.appshot.probeTransitionPresentation`: Replays the native Appshot overlay with an existing screenshot, samples the Core Animation presentation layer tree, writes Cradle-owned presentation PNG frames, and reports geometry/opacity changes.
- `mac.recording.startDisplay`: Starts a Cradle-owned whole-display recording and returns after the recording backend is active, so parity scripts can trigger Appshot while video capture is already running.
- `mac.recording.finishDisplay`: Stops an active whole-display recording, flushes the `.mov`, and returns backend/frame metadata.
- `mac.recording.startWindow`: Arms a Cradle-owned ScreenCaptureKit window-discovery recording. It can wait for a matching Appshot overlay window by process, bundle identifier, explicit window id, and display bounds before starting the stream.
- `mac.recording.finishWindow`: Stops an active window-discovery recording, flushes the `.mov`, and returns selected-window/frame metadata. Empty streams fail instead of being treated as visual proof.

The bridge may emit `event.mac.hotkeyTriggered` when both Command keys are pressed together.

## Ownership

Mac Bridge writes screenshot artifacts only to the caller-provided Cradle-owned output directory. It does not write Chronicle data and does not write CleanShot-owned storage. CleanShot handoff is owned by Electron main as an optional post-capture sink.

The native feedback indicator is owned by Swift/AppKit, not by the renderer. Electron main does not send a separate feedback event; it only requests capture and then runs optional post-capture sinks.

Appshot capture is owned by Mac Bridge and Electron main together: Swift owns native facts, ScreenCaptureKit capture, explicit `targetWindow` resolution, and overlay rendering; Electron main owns output directory, post-capture sinks, Cradle-native image projection, and optional observe-only Codex temp asset evidence for parity reports. Mac Bridge does not call Codex private Apple Event protocols and does not expose Codex Appshot adapter methods.

Appshot probe outputs are Cradle-owned evidence. The visibility probe describes whether an external macOS capture path can see the overlay. The presentation probe describes whether the native Core Animation overlay itself moved. A presentation probe is not treated as Codex parity by itself; it exists to separate native-renderer facts from recorder failures.
