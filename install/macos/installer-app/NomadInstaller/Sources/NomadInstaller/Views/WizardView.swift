import SwiftUI

struct WizardView: View {
    @Bindable var vm: WizardViewModel

    var body: some View {
        VStack(spacing: 0) {
            StepHeader(mode: vm.mode, steps: vm.steps, current: vm.step)
            Divider()
            stepBody
            if vm.step != .progress {
                Divider()
                footer
            }
        }
        .frame(width: 640, height: 560)
        .sheet(isPresented: Binding(get: { vm.runState == .needsPassword }, set: { _ in })) {
            SudoPasswordSheet(vm: vm)
        }
    }

    // Non-progress steps scroll if their content is tall, so the footer (Back /
    // Continue) is always visible. Progress manages its own layout.
    @ViewBuilder private var stepBody: some View {
        if vm.step == .progress {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(24)
        } else {
            ScrollView {
                content
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                    .padding(24)
            }
            .frame(maxHeight: .infinity)
        }
    }

    @ViewBuilder private var content: some View {
        switch vm.step {
        case .welcome: WelcomeStep(vm: vm)
        case .dataDrive: DataDriveStep(vm: vm)
        case .modelTier: ModelTierStep(vm: vm)
        case .backend: BackendStep(vm: vm)
        case .review: ReviewStep(vm: vm)
        case .uninstallReview: UninstallReviewStep(vm: vm)
        case .progress: ProgressStep(vm: vm)
        }
    }

    private var footerTitle: String {
        switch vm.step {
        case .review: "Begin Installation"
        case .uninstallReview: "Uninstall NOMAD"
        default: "Continue"
        }
    }

    private var footer: some View {
        HStack {
            if vm.step != .welcome {
                Button("Back") { vm.back() }
            }
            Spacer()
            Button(footerTitle) { vm.advance() }
                .keyboardShortcut(.defaultAction)
                .disabled(!vm.canAdvance(from: vm.step))
        }
        .padding(16)
    }
}

private struct StepHeader: View {
    let mode: WizardViewModel.Mode
    let steps: [WizardViewModel.Step]
    let current: WizardViewModel.Step

    var body: some View {
        HStack(spacing: 6) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                Text(label(step))
                    .font(.caption)
                    .fontWeight(step == current ? .semibold : .regular)
                    .foregroundStyle(step == current ? Color.primary : .secondary)
                if index < steps.count - 1 {
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 10)
    }

    private func label(_ step: WizardViewModel.Step) -> String {
        switch step {
        case .welcome: "Welcome"
        case .dataDrive: "Drive"
        case .modelTier: "Models"
        case .backend: "Backend"
        case .review: "Review"
        case .uninstallReview: "Confirm"
        case .progress: mode == .install ? "Install" : "Uninstall"
        }
    }
}

#Preview {
    WizardView(vm: WizardViewModel())
}
