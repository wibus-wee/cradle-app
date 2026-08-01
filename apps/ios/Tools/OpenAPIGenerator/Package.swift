// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "CradleOpenAPIGenerator",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.11.1"),
    ],
    targets: []
)
