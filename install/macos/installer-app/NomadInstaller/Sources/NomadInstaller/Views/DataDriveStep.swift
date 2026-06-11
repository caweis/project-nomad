import SwiftUI

struct DataDriveStep: View {
    @Bindable var vm: WizardViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Choose a drive for NOMAD's data").font(.title2).bold()
            Text("Models, maps, and reference content live here. An external drive with plenty of free space is ideal.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            List(selection: selectionBinding) {
                ForEach(vm.volumes) { volume in
                    HStack {
                        Image(systemName: volume.isInternal ? "internaldrive" : "externaldrive")
                        VStack(alignment: .leading) {
                            Text(volume.name)
                            Text("\(byteString(volume.freeBytes)) free of \(byteString(volume.totalBytes))")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(volume.isInternal ? "Internal" : "External")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .tag(volume.id)
                }
            }
            .frame(minHeight: 160)

            if vm.selectedVolume?.isInternal == true {
                Label("This is your internal disk. An external drive with more free space is recommended.",
                      systemImage: "exclamationmark.triangle")
                    .font(.callout)
                    .foregroundStyle(.orange)
            }
        }
        .onAppear { vm.loadVolumes() }
    }

    private var selectionBinding: Binding<String?> {
        Binding(
            get: { vm.selectedVolume?.id },
            set: { id in vm.selectedVolume = vm.volumes.first { $0.id == id } }
        )
    }

    private func byteString(_ bytes: Int64) -> String {
        ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
    }
}
