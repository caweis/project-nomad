import SwiftUI

struct SudoPasswordSheet: View {
    @Bindable var vm: WizardViewModel
    @State private var password = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Administrator password", systemImage: "lock.fill").font(.headline)
            Text("NOMAD needs your password to install Homebrew and system components. This is macOS's standard admin prompt — your password is sent only to the installer and never stored.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            SecureField("Password", text: $password)
                .textFieldStyle(.roundedBorder)
                .onSubmit(submit)

            HStack {
                Spacer()
                Button("Cancel") { cancel() }
                Button("Continue", action: submit)
                    .keyboardShortcut(.defaultAction)
                    .disabled(password.isEmpty)
            }
        }
        .padding(20)
        .frame(width: 400)
    }

    private func submit() {
        guard !password.isEmpty else { return }
        vm.submitPassword(password)
        password = ""
    }

    private func cancel() {
        vm.submitPassword(nil)
        password = ""
    }
}
