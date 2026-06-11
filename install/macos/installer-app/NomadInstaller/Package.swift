// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "NomadInstaller",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "CPTY"),
        .executableTarget(
            name: "NomadInstaller",
            dependencies: ["CPTY"],
            // AppIcon.icns resource is added in Task 11 once the icon exists.
            resources: [.copy("Resources/payload")]
        ),
        .testTarget(name: "NomadInstallerTests", dependencies: ["NomadInstaller"]),
    ]
)
