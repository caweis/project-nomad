import SwiftUI

struct UninstallReviewStep: View {
    @Bindable var vm: WizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Uninstall NOMAD").font(.title2).bold()
            Text("This stops and removes the NOMAD containers and background services. Homebrew, OrbStack, and Ollama stay installed.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            GroupBox {
                VStack(alignment: .leading, spacing: 12) {
                    summaryRow("trash", "Removed",
                               "Containers, background services, and your NOMAD settings and chat history")
                    summaryRow(vm.wipeContent ? "trash.fill" : "checkmark.shield",
                               vm.wipeContent ? "Downloaded content" : "Downloaded content kept",
                               vm.wipeContent
                                   ? "Models, maps, and Wikipedia will be permanently erased"
                                   : "Models, maps, and Wikipedia stay on your drive for next time")
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Toggle("Also erase all downloaded content (models, maps, Wikipedia)", isOn: $vm.wipeContent)

            if vm.wipeContent {
                Label("This permanently deletes your downloaded content — often hundreds of gigabytes — and cannot be undone.",
                      systemImage: "exclamationmark.triangle.fill")
                    .font(.callout).foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Label("Your NOMAD settings and chat history are always removed by uninstall; your downloaded content is kept.",
                      systemImage: "info.circle")
                    .font(.callout).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
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
