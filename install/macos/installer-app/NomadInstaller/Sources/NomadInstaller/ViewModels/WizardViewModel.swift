import Foundation
import Observation

/// Drives the wizard flow and the install run. Main-actor isolated; the blocking
/// PTY work runs in a detached task and hands lines back through an ordered stream.
@MainActor
@Observable
final class WizardViewModel {
    enum Step: Int, CaseIterable { case welcome, dataDrive, modelTier, backend, review, progress }
    enum RunState: Equatable { case idle, running, needsPassword, succeeded, failed(Int32) }

    var step: Step = .welcome

    // Choices
    var volumes: [InstallVolume] = []
    var selectedVolume: InstallVolume?
    var tier: ModelTier = .autoDetected
    var backend: AIBackend = .recommended(arch: AIBackend.currentArch, osMajor: AIBackend.currentOSMajor)

    var omlxEligible: Bool {
        AIBackend.omlxEligible(arch: AIBackend.currentArch, osMajor: AIBackend.currentOSMajor)
    }

    // Run state
    var runState: RunState = .idle
    var lines: [InstallLine] = []
    var currentSection: String = ""

    private var passwordContinuation: CheckedContinuation<String?, Never>?

    func loadVolumes() {
        volumes = VolumeScanner.scan()
        if selectedVolume == nil { selectedVolume = volumes.first }
    }

    func canAdvance(from step: Step) -> Bool {
        switch step {
        case .dataDrive: selectedVolume != nil
        default: true
        }
    }

    func advance() {
        guard let next = Step(rawValue: step.rawValue + 1) else { return }
        step = next
        if next == .progress { startInstall() }
    }

    func back() {
        if let prev = Step(rawValue: step.rawValue - 1) { step = prev }
    }

    // MARK: - Sudo bridge

    /// Called by the password sheet. Resumes the runner with the typed password
    /// (or nil to cancel).
    func submitPassword(_ password: String?) {
        let cont = passwordContinuation
        passwordContinuation = nil
        if runState == .needsPassword { runState = .running }
        cont?.resume(returning: password)
    }

    private func requestPassword() async -> String? {
        runState = .needsPassword
        return await withCheckedContinuation { (cont: CheckedContinuation<String?, Never>) in
            passwordContinuation = cont
        }
    }

    // MARK: - Install

    func startInstall() {
        guard let volume = selectedVolume else { return }
        let cfg = InstallConfig(dataRoot: volume.dataRoot, tier: tier, backend: backend)
        runState = .running
        lines = []
        currentSection = ""

        // Deliver parsed lines to the main actor in order.
        let (stream, continuation) = AsyncStream.makeStream(of: InstallLine.self)
        Task { @MainActor in
            for await line in stream { self.handle(line) }
        }

        // Run the blocking installer off the main actor.
        Task.detached { [weak self] in
            guard let self else { continuation.finish(); return }
            do {
                let nomad = try PayloadProvider.stage()
                let code = try await PTYRunner().run(
                    command: nomad.path,
                    arguments: cfg.installArguments(),
                    onLine: { continuation.yield($0) },
                    passwordProvider: { await self.requestPassword() }
                )
                continuation.finish()
                await MainActor.run { self.runState = code == 0 ? .succeeded : .failed(code) }
            } catch {
                continuation.finish()
                await MainActor.run { self.runState = .failed(-1) }
            }
        }
    }

    private func handle(_ line: InstallLine) {
        if case let .section(title) = line.kind { currentSection = title }
        lines.append(line)
    }
}
