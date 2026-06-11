import SwiftUI

struct ModelTierStep: View {
    @Bindable var vm: WizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Choose a model size").font(.title2).bold()
            Text("Recommended for this Mac: \(ModelTier.autoDetected.displayName) (about \(ModelTier.autoDetected.approxPullGB) GB to download).")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Picker("Model size", selection: $vm.tier) {
                ForEach(ModelTier.allCases) { tier in
                    Text("\(tier.displayName) — about \(tier.approxPullGB) GB").tag(tier)
                }
            }
            .pickerStyle(.radioGroup)
            .labelsHidden()

            Text("Larger tiers need more RAM and disk. You can change models later with the CLI.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }
}
