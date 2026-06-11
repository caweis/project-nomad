import SwiftUI

@main
struct NomadInstallerApp: App {
    var body: some Scene {
        Window("Install NOMAD", id: "main") {
            Text("NOMAD Installer")
                .frame(width: 640, height: 460)
        }
        .windowResizability(.contentSize)
    }
}
