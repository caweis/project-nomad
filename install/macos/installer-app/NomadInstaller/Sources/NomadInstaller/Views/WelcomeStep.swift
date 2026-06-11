import SwiftUI

struct WelcomeStep: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Install NOMAD").font(.largeTitle).bold()
            Text("NOMAD turns this Mac into an offline AI and knowledge server — local chat, a drug reference, preparedness guides, maps, and Wikipedia, all available without the internet.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            GroupBox("This installer will set up") {
                VStack(alignment: .leading, spacing: 6) {
                    row("shippingbox", "Homebrew and OrbStack (container runtime)")
                    row("brain", "An AI backend (Ollama or Apple oMLX)")
                    row("square.stack.3d.up", "The NOMAD admin containers")
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(6)
            }

            Text("Plan for tens of gigabytes of downloads and an external drive with room to spare. You'll be asked for your password once, the same as in Terminal.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func row(_ symbol: String, _ text: String) -> some View {
        Label(text, systemImage: symbol)
    }
}

#Preview {
    WelcomeStep().padding().frame(width: 640, height: 400)
}
