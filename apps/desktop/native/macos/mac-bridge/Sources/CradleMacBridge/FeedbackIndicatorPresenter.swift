// Presents reusable AppKit feedback indicators for native Mac Bridge actions.
import AppKit
import QuartzCore

enum FeedbackIndicatorTone {
    case success
    case failure
}

enum FeedbackIndicatorIcon {
    case camera
    case check
    case xmark
}

struct FeedbackIndicatorContent {
    let tone: FeedbackIndicatorTone
    let icon: FeedbackIndicatorIcon
    let label: String
    let detail: String?
    let duration: TimeInterval
    let targetWindowBounds: [String: Double]?
    let revealFilePath: String?

    static func success(
        label: String,
        detail: String? = nil,
        icon: FeedbackIndicatorIcon = .check,
        targetWindowBounds: [String: Double]? = nil,
        revealFilePath: String? = nil
    ) -> FeedbackIndicatorContent {
        FeedbackIndicatorContent(
            tone: .success,
            icon: icon,
            label: label,
            detail: detail,
            duration: 3.4,
            targetWindowBounds: targetWindowBounds,
            revealFilePath: revealFilePath
        )
    }

    static func failure(
        label: String,
        detail: String? = nil,
        icon: FeedbackIndicatorIcon = .xmark,
        targetWindowBounds: [String: Double]? = nil
    ) -> FeedbackIndicatorContent {
        FeedbackIndicatorContent(
            tone: .failure,
            icon: icon,
            label: label,
            detail: detail,
            duration: 2.8,
            targetWindowBounds: targetWindowBounds,
            revealFilePath: nil
        )
    }
}

final class FeedbackIndicatorPresenter: @unchecked Sendable {
    private var panel: NSPanel?
    private var dismissWorkItem: DispatchWorkItem?
    private var presentationId = 0

    func show(_ content: FeedbackIndicatorContent) {
        Task { @MainActor [weak self] in
            self?.showOnMain(content)
        }
    }

    @MainActor
    private func showOnMain(_ content: FeedbackIndicatorContent) {
        let application = NSApplication.shared
        if application.activationPolicy() == .regular {
            application.setActivationPolicy(.accessory)
        }

        dismissWorkItem?.cancel()
        presentationId += 1
        let currentPresentationId = presentationId

        let view = FeedbackIndicatorContainerView(content: content)
        view.translatesAutoresizingMaskIntoConstraints = false
        let fittingSize = view.intrinsicContentSize
        let panelSize = NSSize(
            width: min(max(fittingSize.width, 200), 340),
            height: content.detail == nil ? 44 : 56
        )
        let panel = self.panel ?? createPanel()
        self.panel = panel
        panel.contentView = view
        panel.setFrame(readFrame(size: panelSize, targetWindowBounds: content.targetWindowBounds), display: true)
        view.layoutSubtreeIfNeeded()
        view.prepareForEntrance()
        panel.alphaValue = 1
        panel.orderFrontRegardless()

        animateIn(panel: panel)

        let workItem = DispatchWorkItem { [weak self, weak panel] in
            guard let panel else { return }
            self?.animateOut(panel: panel, presentationId: currentPresentationId)
        }
        dismissWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + content.duration, execute: workItem)
    }

    @MainActor
    private func createPanel() -> NSPanel {
        let panel = FeedbackIndicatorPanel(
            contentRect: .zero,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.level = .statusBar
        panel.ignoresMouseEvents = false
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        return panel
    }

    @MainActor
    private func readFrame(size: NSSize, targetWindowBounds: [String: Double]?) -> NSRect {
        let screen = readTargetScreen(targetWindowBounds: targetWindowBounds)
        let visibleFrame = screen.visibleFrame
        let origin = NSPoint(
            x: visibleFrame.midX - size.width / 2,
            y: visibleFrame.maxY - size.height - 22
        )
        return NSRect(origin: origin, size: size)
    }

    @MainActor
    private func readTargetScreen(targetWindowBounds: [String: Double]?) -> NSScreen {
        if let targetWindowBounds, let screen = readScreen(containing: targetWindowBounds) {
            return screen
        }
        let mouseLocation = NSEvent.mouseLocation
        return NSScreen.screens.first(where: { $0.frame.contains(mouseLocation) }) ?? NSScreen.main ?? NSScreen.screens[0]
    }

    @MainActor
    private func readScreen(containing bounds: [String: Double]) -> NSScreen? {
        guard let x = bounds["x"],
              let y = bounds["y"],
              let width = bounds["width"],
              let height = bounds["height"]
        else {
            return nil
        }

        let center = NSPoint(x: x + width / 2, y: y + height / 2)
        return NSScreen.screens.first { $0.frame.contains(center) }
    }

    @MainActor
    private func animateIn(panel: NSPanel) {
        guard let contentView = panel.contentView as? FeedbackIndicatorContainerView else {
            return
        }
        contentView.playEntrance()
    }

    @MainActor
    private func animateOut(panel: NSPanel, presentationId targetPresentationId: Int) {
        guard presentationId == targetPresentationId else { return }
        guard let contentView = panel.contentView as? FeedbackIndicatorContainerView else {
            panel.orderOut(nil)
            if self.panel === panel {
                self.panel = nil
            }
            return
        }
        contentView.playExit { [weak self, weak panel] in
            guard self?.presentationId == targetPresentationId else { return }
            panel?.orderOut(nil)
            if self?.panel === panel {
                self?.panel = nil
            }
        }
    }
}

final class FeedbackIndicatorPanel: NSPanel {
    override var canBecomeKey: Bool {
        false
    }

    override var canBecomeMain: Bool {
        false
    }
}

final class FeedbackIndicatorContainerView: NSView {
    private let indicatorView: FeedbackIndicatorView
    private let entranceStartScale: CGFloat = 0.96

    init(content: FeedbackIndicatorContent) {
        indicatorView = FeedbackIndicatorView(content: content)
        super.init(frame: .zero)
        wantsLayer = true
        layer?.masksToBounds = false

        layer?.shadowColor = NSColor.black.withAlphaComponent(0.18).cgColor
        layer?.shadowOffset = CGSize(width: 0, height: -2)
        layer?.shadowRadius = 12
        layer?.shadowOpacity = 1
        layer?.shouldRasterize = true
        layer?.rasterizationScale = NSScreen.main?.backingScaleFactor ?? 2

        indicatorView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(indicatorView)
        NSLayoutConstraint.activate([
            indicatorView.leadingAnchor.constraint(equalTo: leadingAnchor),
            indicatorView.trailingAnchor.constraint(equalTo: trailingAnchor),
            indicatorView.topAnchor.constraint(equalTo: topAnchor),
            indicatorView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override var intrinsicContentSize: NSSize {
        indicatorView.intrinsicContentSize
    }

    override func layout() {
        super.layout()
        layer?.rasterizationScale = window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        layer?.shadowPath = CGPath(
            roundedRect: bounds,
            cornerWidth: 12,
            cornerHeight: 12,
            transform: nil
        )
    }

    func prepareForEntrance() {
        guard let layer else { return }
        configureCenteredAnchor(for: layer)
        layer.removeAllAnimations()

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.transform = CATransform3DMakeScale(entranceStartScale, entranceStartScale, 1)
        layer.opacity = 0
        CATransaction.commit()
        indicatorView.prepareForEntrance()
    }

    func playEntrance() {
        guard let layer else { return }
        configureCenteredAnchor(for: layer)
        layer.removeAllAnimations()

        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = entranceStartScale
        scale.toValue = 1
        scale.duration = 0.18
        scale.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0, 0, 1)

        let opacity = CABasicAnimation(keyPath: "opacity")
        opacity.fromValue = 0
        opacity.toValue = 1
        opacity.duration = 0.12
        opacity.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0, 0, 1)

        let group = CAAnimationGroup()
        group.animations = [scale, opacity]
        group.duration = 0.18
        group.isRemovedOnCompletion = true

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.transform = CATransform3DIdentity
        layer.opacity = 1
        CATransaction.commit()

        layer.add(group, forKey: "cradle-bridge-surface-enter")
        indicatorView.playEntrance()
    }

    func playExit(completion: @escaping () -> Void) {
        guard let layer else {
            completion()
            return
        }
        configureCenteredAnchor(for: layer)
        layer.removeAnimation(forKey: "cradle-bridge-surface-enter")

        let scale = CABasicAnimation(keyPath: "transform.scale")
        scale.fromValue = readPresentationScale(from: layer)
        scale.toValue = 0.98
        scale.duration = 0.12
        scale.timingFunction = CAMediaTimingFunction(controlPoints: 0.4, 0, 1, 1)

        let opacity = CABasicAnimation(keyPath: "opacity")
        opacity.fromValue = layer.presentation()?.opacity ?? layer.opacity
        opacity.toValue = 0
        opacity.duration = 0.10
        opacity.timingFunction = CAMediaTimingFunction(controlPoints: 0.4, 0, 1, 1)

        let group = CAAnimationGroup()
        group.animations = [scale, opacity]
        group.duration = 0.12
        group.fillMode = .forwards
        group.isRemovedOnCompletion = false

        indicatorView.playExit()

        CATransaction.begin()
        CATransaction.setCompletionBlock(completion)
        CATransaction.setDisableActions(true)
        layer.transform = CATransform3DMakeScale(0.98, 0.98, 1)
        layer.opacity = 0
        CATransaction.setDisableActions(false)
        layer.add(group, forKey: "cradle-bridge-surface-exit")
        CATransaction.commit()
    }

    private func configureCenteredAnchor(for layer: CALayer) {
        let frame = layer.frame
        layer.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        layer.frame = frame
    }

    private func readPresentationScale(from layer: CALayer) -> CGFloat {
        guard let value = layer.presentation()?.value(forKeyPath: "transform.scale") else {
            return 1
        }
        if let number = value as? NSNumber {
            return CGFloat(truncating: number)
        }
        if let scale = value as? CGFloat {
            return scale
        }
        return 1
    }
}

final class FeedbackIndicatorView: NSView {
    private let content: FeedbackIndicatorContent
    private let iconView: FeedbackIconView
    private let textStack = NSStackView()
    private var revealButton: NSButton?
    private let cornerRadius: CGFloat = 12

    init(content: FeedbackIndicatorContent) {
        self.content = content
        iconView = FeedbackIconView(tone: content.tone, icon: content.icon)
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = cornerRadius
        layer?.cornerCurve = .continuous
        layer?.masksToBounds = true

        let blur = NSVisualEffectView()
        blur.material = .hudWindow
        blur.blendingMode = .behindWindow
        blur.state = .followsWindowActiveState
        blur.wantsLayer = true
        blur.layer?.cornerRadius = cornerRadius
        blur.layer?.cornerCurve = .continuous
        blur.translatesAutoresizingMaskIntoConstraints = false
        addSubview(blur, positioned: .below, relativeTo: nil)
        NSLayoutConstraint.activate([
            blur.leadingAnchor.constraint(equalTo: leadingAnchor),
            blur.trailingAnchor.constraint(equalTo: trailingAnchor),
            blur.topAnchor.constraint(equalTo: topAnchor),
            blur.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        layer?.borderWidth = 0.5
        layer?.borderColor = NSColor.white.withAlphaComponent(0.18).cgColor

        setupContent()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override var intrinsicContentSize: NSSize {
        let baseWidth: CGFloat = content.revealFilePath == nil ? 240 : 272
        let height: CGFloat = content.detail == nil ? 44 : 56
        return NSSize(width: baseWidth, height: height)
    }

    func prepareForEntrance() {
        animatedViews.forEach { view in
            view.wantsLayer = true
            guard let layer = view.layer else {
                return
            }
            configureCenteredAnchor(for: layer)
            layer.removeAllAnimations()

            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.opacity = 0
            layer.transform = CATransform3DIdentity
            CATransaction.commit()
        }
    }

    func playEntrance() {
        animatedViews.forEach { view in
            playFadeIn(on: view.layer)
        }
    }

    func playExit() {
        animatedViews.forEach { view in
            guard let layer = view.layer else {
                return
            }
            layer.removeAllAnimations()

            let opacity = CABasicAnimation(keyPath: "opacity")
            opacity.fromValue = layer.presentation()?.opacity ?? layer.opacity
            opacity.toValue = 0
            opacity.duration = 0.08
            opacity.timingFunction = CAMediaTimingFunction(controlPoints: 0.4, 0, 1, 1)
            opacity.fillMode = .forwards
            opacity.isRemovedOnCompletion = false

            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.transform = CATransform3DIdentity
            layer.opacity = 0
            CATransaction.setDisableActions(false)
            layer.add(opacity, forKey: "cradle-bridge-piece-exit")
            CATransaction.commit()
        }
    }

    private func setupContent() {
        iconView.translatesAutoresizingMaskIntoConstraints = false

        textStack.orientation = .vertical
        textStack.alignment = .leading
        textStack.spacing = 2
        textStack.translatesAutoresizingMaskIntoConstraints = false
        textStack.wantsLayer = true

        let label = NSTextField(labelWithString: content.label)
        label.font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        label.textColor = .labelColor
        label.lineBreakMode = .byTruncatingTail
        textStack.addArrangedSubview(label)

        if let detail = content.detail, !detail.isEmpty {
            let detailLabel = NSTextField(labelWithString: detail)
            detailLabel.font = NSFont.systemFont(ofSize: 11, weight: .regular)
            detailLabel.textColor = .secondaryLabelColor
            detailLabel.lineBreakMode = .byTruncatingMiddle
            textStack.addArrangedSubview(detailLabel)
        }

        let stack = NSStackView(views: [iconView, textStack])
        stack.orientation = .horizontal
        stack.alignment = .centerY
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            iconView.widthAnchor.constraint(equalToConstant: 26),
            iconView.heightAnchor.constraint(equalToConstant: 26),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 10),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])

        if content.revealFilePath != nil {
            let button = createRevealButton()
            revealButton = button
            addSubview(button)
            NSLayoutConstraint.activate([
                button.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
                button.centerYAnchor.constraint(equalTo: centerYAnchor),
                textStack.trailingAnchor.constraint(lessThanOrEqualTo: button.leadingAnchor, constant: -8),
            ])
        } else {
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8).isActive = true
        }
    }

    private func createRevealButton() -> NSButton {
        let image = NSImage(systemSymbolName: "folder", accessibilityDescription: "Reveal in Finder")
            ?? NSImage(size: NSSize(width: 16, height: 16))
        let button = NSButton(image: image, target: self, action: #selector(revealInFinder))
        button.translatesAutoresizingMaskIntoConstraints = false
        button.isBordered = false
        button.bezelStyle = .regularSquare
        button.imagePosition = .imageOnly
        button.toolTip = "Reveal in Finder"
        button.wantsLayer = true
        button.layer?.cornerRadius = 13
        button.layer?.cornerCurve = .continuous
        button.layer?.backgroundColor = NSColor.controlAccentColor.withAlphaComponent(0.14).cgColor
        button.contentTintColor = .labelColor
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 26),
            button.heightAnchor.constraint(equalToConstant: 26),
        ])
        return button
    }

    @objc private func revealInFinder() {
        guard let revealFilePath = content.revealFilePath else {
            return
        }
        NSWorkspace.shared.activateFileViewerSelecting([
            URL(fileURLWithPath: revealFilePath),
        ])
    }

    private var animatedViews: [NSView] {
        var views: [NSView] = [iconView, textStack]
        if let revealButton {
            views.append(revealButton)
        }
        return views
    }

    private func playFadeIn(on layer: CALayer?) {
        guard let layer else {
            return
        }
        configureCenteredAnchor(for: layer)
        layer.removeAllAnimations()

        let opacity = CABasicAnimation(keyPath: "opacity")
        opacity.fromValue = 0
        opacity.toValue = 1
        opacity.duration = 0.12
        opacity.timingFunction = CAMediaTimingFunction(controlPoints: 0.2, 0, 0, 1)

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.transform = CATransform3DIdentity
        layer.opacity = 1
        CATransaction.commit()

        layer.add(opacity, forKey: "cradle-bridge-piece-enter")
    }

    private func configureCenteredAnchor(for layer: CALayer) {
        let frame = layer.frame
        layer.anchorPoint = CGPoint(x: 0.5, y: 0.5)
        layer.frame = frame
    }

}

final class FeedbackIconView: NSView {
    private let tone: FeedbackIndicatorTone
    private let icon: FeedbackIndicatorIcon

    init(tone: FeedbackIndicatorTone, icon: FeedbackIndicatorIcon) {
        self.tone = tone
        self.icon = icon
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 7
        layer?.cornerCurve = .continuous
        layer?.backgroundColor = backgroundColor.cgColor
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    private var backgroundColor: NSColor {
        switch tone {
        case .success:
            return NSColor.systemGreen.withAlphaComponent(0.16)
        case .failure:
            return NSColor.systemRed.withAlphaComponent(0.16)
        }
    }

    private var strokeColor: NSColor {
        switch tone {
        case .success:
            return .systemGreen
        case .failure:
            return .systemRed
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        strokeColor.setStroke()
        let path = NSBezierPath()
        path.lineWidth = 2
        path.lineCapStyle = .round
        path.lineJoinStyle = .round

        switch icon {
        case .camera:
            drawCameraIcon(path: path)
        case .check:
            path.move(to: NSPoint(x: 8, y: 14))
            path.line(to: NSPoint(x: 12, y: 10))
            path.line(to: NSPoint(x: 20, y: 18))
        case .xmark:
            path.move(to: NSPoint(x: 9, y: 9))
            path.line(to: NSPoint(x: 19, y: 19))
            path.move(to: NSPoint(x: 19, y: 9))
            path.line(to: NSPoint(x: 9, y: 19))
        }
        path.stroke()
    }

    private func drawCameraIcon(path: NSBezierPath) {
        let body = NSBezierPath(roundedRect: NSRect(x: 7, y: 9, width: 14, height: 11), xRadius: 3, yRadius: 3)
        body.lineWidth = 2
        body.stroke()

        let lens = NSBezierPath(ovalIn: NSRect(x: 11, y: 12, width: 6, height: 6))
        lens.lineWidth = 2
        lens.stroke()

        path.move(to: NSPoint(x: 10, y: 20))
        path.line(to: NSPoint(x: 12, y: 22))
        path.line(to: NSPoint(x: 16, y: 22))
        path.line(to: NSPoint(x: 18, y: 20))
    }
}
