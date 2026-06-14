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
            .disabled(vm.skipModels)
            .opacity(vm.skipModels ? 0.4 : 1)

            Divider().padding(.vertical, 2)

            Toggle("Skip for now — install NOMAD and download models later", isOn: $vm.skipModels)

            Text("Larger tiers need more RAM and disk. Skipping installs everything except the models; pull them anytime with the CLI.")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }
}
