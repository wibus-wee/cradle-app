// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CradleMacBridge",
    platforms: [
        .macOS(.v13),
    ],
    products: [
        .executable(name: "cradle-mac-bridge", targets: ["CradleMacBridge"]),
    ],
    targets: [
        .executableTarget(
            name: "CradleMacBridge",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("ApplicationServices"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("QuartzCore"),
                .linkedFramework("ScreenCaptureKit"),
            ]
        ),
    ]
)
