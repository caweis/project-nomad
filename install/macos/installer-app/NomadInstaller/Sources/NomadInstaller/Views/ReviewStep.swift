import SwiftUI

struct ReviewStep: View {
    @Bindable var vm: WizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Ready to install").font(.title2).bold()
            Text("Review your choices. Installing downloads tens of gigabytes and changes this Mac — it sets up Homebrew, OrbStack, and the NOMAD containers.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            GroupBox {
                VStack(alignment: .leading, spacing: 12) {
                    summaryRow("externaldrive", "Install location", vm.selectedVolume?.dataRoot ?? "—")
                    summaryRow("brain", "Models", vm.skipModels ? "Skipped — download later with the CLI" : "\(vm.tier.displayName) — about \(vm.tier.approxPullGB) GB to download")
                    summaryRow("cpu", "AI backend", vm.backend.displayName)
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Label("You'll be asked for your password once, the same as in Terminal.", systemImage: "lock")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private func summaryRow(_ symbol: String, _ label: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: symbol)
                .foregroundStyle(.secondary)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(label).font(.caption).foregroundStyle(.secondary)
                Text(value).font(.body)
            }
        }
    }
}
