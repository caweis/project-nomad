import SwiftUI

struct WelcomeStep: View {
    @Bindable var vm: WizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("NOMAD").font(.largeTitle).bold()
            Text("An offline AI and knowledge server for this Mac — local chat, a drug reference, preparedness guides, maps, and Wikipedia, all available without the internet.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 12) {
                modeCard(.install, "Install", "arrow.down.circle", "Set up NOMAD on this Mac")
                modeCard(.uninstall, "Uninstall", "trash", "Remove NOMAD from this Mac")
            }

            if vm.mode == .install {
                GroupBox("This installer will set up") {
                    VStack(alignment: .leading, spacing: 6) {
                        Label("Homebrew and OrbStack (container runtime)", systemImage: "shippingbox")
                        Label("An AI backend (Ollama or Apple oMLX)", systemImage: "brain")
                        Label("The NOMAD admin containers", systemImage: "square.stack.3d.up")
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(6)
                }
                Text("Plan for tens of gigabytes of downloads. You'll be asked for your password once, the same as in Terminal.")
                    .font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Removes the NOMAD containers, services, and settings. Homebrew, OrbStack, and Ollama stay installed. On the next screen you choose whether to keep your downloaded content.")
                    .font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func modeCard(_ choice: WizardViewModel.Mode, _ title: String, _ icon: String, _ subtitle: String) -> some View {
        Button { vm.mode = choice } label: {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: icon).font(.title2)
                Text(title).font(.headline)
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 86, alignment: .topLeading)
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(vm.mode == choice ? Color.accentColor.opacity(0.15) : Color.secondary.opacity(0.08))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(vm.mode == choice ? Color.accentColor : Color.secondary.opacity(0.25),
                            lineWidth: vm.mode == choice ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    WelcomeStep(vm: WizardViewModel()).padding().frame(width: 640, height: 460)
}
