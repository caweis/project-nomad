import SwiftUI

struct BackendStep: View {
    @Bindable var vm: WizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Choose an AI backend").font(.title2).bold()
            Text("Ollama runs anywhere. oMLX uses Apple's MLX for faster inference on recent Apple Silicon.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Picker("AI backend", selection: $vm.backend) {
                Text("Ollama").tag(AIBackend.ollama)
                if vm.omlxEligible {
                    Text("oMLX (Apple MLX)").tag(AIBackend.omlx)
                }
            }
            .pickerStyle(.radioGroup)
            .labelsHidden()

            if !vm.omlxEligible {
                Label("oMLX requires Apple Silicon and macOS 15 or later, so Ollama will be used.",
                      systemImage: "info.circle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
