import SwiftUI

struct WizardView: View {
    @Bindable var vm: WizardViewModel

    var body: some View {
        VStack(spacing: 0) {
            StepHeader(current: vm.step)
            Divider()
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(24)
            if vm.step != .progress {
                Divider()
                footer
            }
        }
        .frame(width: 640, height: 460)
        .sheet(isPresented: Binding(get: { vm.runState == .needsPassword }, set: { _ in })) {
            SudoPasswordSheet(vm: vm)
        }
    }

    @ViewBuilder private var content: some View {
        switch vm.step {
        case .welcome: WelcomeStep()
        case .dataDrive: DataDriveStep(vm: vm)
        case .modelTier: ModelTierStep(vm: vm)
        case .backend: BackendStep(vm: vm)
        case .progress: ProgressStep(vm: vm)
        }
    }

    private var footer: some View {
        HStack {
            if vm.step != .welcome {
                Button("Back") { vm.back() }
            }
            Spacer()
            Button(vm.step == .backend ? "Install" : "Continue") { vm.advance() }
                .keyboardShortcut(.defaultAction)
                .disabled(!vm.canAdvance(from: vm.step))
        }
        .padding(16)
    }
}

private struct StepHeader: View {
    let current: WizardViewModel.Step

    private let labels: [(WizardViewModel.Step, String)] = [
        (.welcome, "Welcome"), (.dataDrive, "Drive"), (.modelTier, "Models"),
        (.backend, "Backend"), (.progress, "Install"),
    ]

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(labels.enumerated()), id: \.offset) { index, item in
                Text(item.1)
                    .font(.caption)
                    .fontWeight(item.0 == current ? .semibold : .regular)
                    .foregroundStyle(item.0 == current ? Color.primary : .secondary)
                if index < labels.count - 1 {
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 10)
    }
}

#Preview {
    WizardView(vm: WizardViewModel())
}
