// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "CradleAPI",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [
        .library(name: "CradleAPI", targets: ["CradleAPI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.8.2"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.2.0"),
        .package(url: "https://github.com/apple/swift-http-types", from: "1.4.0"),
        .package(url: "https://github.com/DePasqualeOrg/swift-sse", from: "0.1.0"),
    ],
    targets: [
        .target(
            name: "CradleAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "SSE", package: "swift-sse"),
            ],
            exclude: [
                "openapi-generator-config.yaml",
                "openapi.json",
            ]
        ),
    ]
)
