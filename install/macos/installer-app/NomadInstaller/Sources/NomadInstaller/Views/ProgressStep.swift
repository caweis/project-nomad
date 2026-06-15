import SwiftUI
import AppKit

struct ProgressStep: View {
    @Bindable var vm: WizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            logDisclosure
            Spacer(minLength: 0)
            footer
        }
    }

    @ViewBuilder private var header: some View {
        switch vm.runState {
        case .succeeded:
            Label(vm.mode == .install ? "NOMAD is installed" : "NOMAD removed",
                  systemImage: "checkmark.circle.fill")
                .font(.title2).bold().foregroundStyle(.green)
        case .failed:
            Label("Install hit a problem", systemImage: "xmark.octagon.fill")
                .font(.title2).bold().foregroundStyle(.red)
        default:
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text(vm.currentSection.isEmpty ? "Starting…" : vm.currentSection)
                    .font(.title2).bold()
            }
        }
    }

    private var logDisclosure: some View {
        DisclosureGroup("Details") {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 1) {
                        ForEach(vm.lines) { line in
                            Text(text(for: line))
                                .font(.system(.caption, design: .monospaced))
                                .foregroundStyle(tint(for: line))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .id(line.id)
                        }
                    }
                    .padding(6)
                }
                .frame(height: 180)
                .background(Color(nsColor: .textBackgroundColor))
                .onChange(of: vm.lines.count) {
                    if let last = vm.lines.last { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    @ViewBuilder private var footer: some View {
        switch vm.runState {
        case .succeeded:
            HStack {
                Spacer()
                if vm.mode == .install {
                    Button("Open NOMAD") {
                        if let url = URL(string: "http://localhost:8080") { NSWorkspace.shared.open(url) }
                    }
                    .keyboardShortcut(.defaultAction)
                } else {
                    Button("Quit") { NSApplication.shared.terminate(nil) }
                        .keyboardShortcut(.defaultAction)
                }
            }
        case .failed:
            HStack {
                Button("Copy full log") { copyLog() }
                Spacer()
                Button("Try again") { vm.start() }
                    .keyboardShortcut(.defaultAction)
            }
        default:
            EmptyView()
        }
    }

    private func text(for line: InstallLine) -> String {
        switch line.kind {
        case let .section(s): "── \(s) ──"
        case let .step(s): "==> \(s)"
        case let .success(s): "✓ \(s)"
        case let .warning(s): "⚠ \(s)"
        case let .error(s): "✗ \(s)"
        case .prompt: "(password prompt)"
        case let .raw(s): s
        }
    }

    private func tint(for line: InstallLine) -> Color {
        switch line.kind {
        case .section: .primary
        case .success: .green
        case .warning: .orange
        case .error: .red
        default: .secondary
        }
    }

    private func copyLog() {
        let text = vm.lines.map { self.text(for: $0) }.joined(separator: "\n")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}
