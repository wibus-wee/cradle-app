// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "WatchOut",
  platforms: [
    .macOS(.v14),
  ],
  products: [
    .library(name: "WatchOutCore", targets: ["WatchOutCore"]),
    .library(name: "WatchOutUI", targets: ["WatchOutUI"]),
    .executable(name: "watchout", targets: ["WatchOutCLI"]),
    .executable(name: "watchout-mcp", targets: ["WatchOutMCP"]),
  ],
  dependencies: [
    .package(url: "https://github.com/groue/GRDB.swift.git", from: "7.0.0"),
    .package(url: "https://github.com/sindresorhus/Defaults.git", from: "9.0.0"),
    .package(url: "https://github.com/sindresorhus/KeyboardShortcuts.git", from: "2.0.0"),
    .package(url: "https://github.com/sindresorhus/LaunchAtLogin-Modern.git", from: "1.1.0"),
    .package(url: "https://github.com/orchetect/MenuBarExtraAccess.git", from: "1.2.0"),
    .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.5.0"),
    .package(url: "https://github.com/apple/swift-algorithms.git", from: "1.2.0"),
    .package(url: "https://github.com/apple/swift-async-algorithms.git", from: "1.0.0"),
    .package(url: "https://github.com/modelcontextprotocol/swift-sdk.git", from: "0.11.0"),
    .package(url: "https://github.com/pointfreeco/swift-dependencies.git", from: "1.6.0"),
    .package(url: "https://github.com/pointfreeco/swift-identified-collections.git", from: "1.1.0"),
    .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0"),
  ],
  targets: [
    .target(
      name: "WatchOutCore",
      dependencies: [
        .product(name: "GRDB", package: "GRDB.swift"),
        .product(name: "Algorithms", package: "swift-algorithms"),
        .product(name: "Dependencies", package: "swift-dependencies"),
        .product(name: "IdentifiedCollections", package: "swift-identified-collections"),
      ],
      path: "Sources/WatchOutCore"
    ),
    .target(
      name: "WatchOutUI",
      dependencies: [
        "WatchOutCore",
        .product(name: "AsyncAlgorithms", package: "swift-async-algorithms"),
        .product(name: "Defaults", package: "Defaults"),
        .product(name: "KeyboardShortcuts", package: "KeyboardShortcuts"),
        .product(name: "LaunchAtLogin", package: "LaunchAtLogin-Modern"),
        .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
        .product(name: "Dependencies", package: "swift-dependencies"),
        .product(name: "IdentifiedCollections", package: "swift-identified-collections"),
        .product(name: "Sparkle", package: "Sparkle"),
      ],
      path: "Sources/WatchOutUI"
    ),
    .executableTarget(
      name: "WatchOutCLI",
      dependencies: [
        "WatchOutCore",
        .product(name: "ArgumentParser", package: "swift-argument-parser"),
      ],
      path: "Sources/WatchOutCLI"
    ),
    .executableTarget(
      name: "WatchOutMCP",
      dependencies: [
        "WatchOutCore",
        .product(name: "MCP", package: "swift-sdk"),
      ],
      path: "Sources/WatchOutMCP"
    ),
    .testTarget(
      name: "WatchOutCoreTests",
      dependencies: [
        "WatchOutCore",
        .product(name: "IdentifiedCollections", package: "swift-identified-collections"),
      ],
      path: "Tests/WatchOutCoreTests"
    ),
  ]
)
