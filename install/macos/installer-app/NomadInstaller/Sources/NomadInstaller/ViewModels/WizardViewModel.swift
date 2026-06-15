import Foundation
import Observation

/// Drives the wizard flow and the install run. Main-actor isolated; the blocking
/// PTY work runs in a detached task and hands lines back through an ordered stream.
@MainActor
@Observable
final class WizardViewModel {
    enum Mode: Equatable { case install, uninstall }
    enum Step: Equatable { case welcome, dataDrive, modelTier, backend, review, uninstallReview, progress }
    enum RunState: Equatable { case idle, running, needsPassword, succeeded, failed(Int32) }

    var mode: Mode = .install
    var step: Step = .welcome

    // Choices
    var volumes: [InstallVolume] = []
    var selectedVolume: InstallVolume?
    var tier: ModelTier = .autoDetected
    var skipModels: Bool = false
    var backend: AIBackend = .recommended(arch: AIBackend.currentArch, osMajor: AIBackend.currentOSMajor)

    // Uninstall: also erase downloaded content (models/maps/Wikipedia). Default keep.
    var wipeContent: Bool = false

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

    /// The step sequence for the current mode. Install keeps its full six-step
    /// path; uninstall is a short Welcome → Confirm → Progress flow.
    var steps: [Step] {
        switch mode {
        case .install: [.welcome, .dataDrive, .modelTier, .backend, .review, .progress]
        case .uninstall: [.welcome, .uninstallReview, .progress]
        }
    }

    func canAdvance(from step: Step) -> Bool {
        switch step {
        case .dataDrive: selectedVolume != nil
        default: true
        }
    }

    func advance() {
        guard let i = steps.firstIndex(of: step), i + 1 < steps.count else { return }
        step = steps[i + 1]
        if step == .progress { start() }
    }

    func back() {
        guard let i = steps.firstIndex(of: step), i > 0 else { return }
        step = steps[i - 1]
    }

    /// Run the action for the current mode (also used by the progress "Try again").
    func start() {
        switch mode {
        case .install: startInstall()
        case .uninstall: startUninstall()
        }
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
        let cfg = InstallConfig(dataRoot: volume.dataRoot, tier: tier, backend: backend, skipModels: skipModels)
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

    func startUninstall() {
        let cfg = UninstallConfig(keepData: !wipeContent)
        runState = .running
        lines = []
        currentSection = ""

        let (stream, continuation) = AsyncStream.makeStream(of: InstallLine.self)
        Task { @MainActor in
            for await line in stream { self.handle(line) }
        }

        Task.detached { [weak self] in
            guard let self else { continuation.finish(); return }
            do {
                let nomad = try PayloadProvider.stage()
                let code = try await PTYRunner().run(
                    command: nomad.path,
                    arguments: cfg.uninstallArguments(),
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
