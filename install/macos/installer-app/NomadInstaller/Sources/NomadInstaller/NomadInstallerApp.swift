import SwiftUI

@main
struct NomadInstallerApp: App {
    init() {
        if CommandLine.arguments.contains("--selfcheck") { SelfCheck.runAndExit() }
    }

    @State private var vm = WizardViewModel()

    var body: some Scene {
        Window("Install NOMAD", id: "main") {
            WizardView(vm: vm)
        }
        .windowResizability(.contentSize)
    }
}
