// swift-tools-version: 6.0
import PackageDescription

// PTYSpike — feasibility probe for the NOMAD Installer.app.
// Proves the one piece of novel code in the installer: driving `nomad install`
// (which prompts for sudo on its controlling TTY) from a GUI process by running
// it inside a pseudo-terminal and intercepting the password prompt.
//
// The CPTY C target here is the seed of the app's eventual PTYRunner.
let package = Package(
    name: "PTYSpike",
    targets: [
        .target(name: "CPTY"),
        .executableTarget(name: "PTYSpike", dependencies: ["CPTY"]),
    ]
)
