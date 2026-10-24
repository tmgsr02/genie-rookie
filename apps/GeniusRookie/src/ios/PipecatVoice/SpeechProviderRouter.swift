import Foundation
import Observation

/// Model/UI state is main-actor isolated. Preparation drains serially; cancelled SDK
/// work may finish late, but only the current generation may commit a selection.
@MainActor @Observable
final class SpeechProviderRouter {
    private(set) var preferredProvider: SpeechProvider
    private(set) var activeProvider: SpeechProvider?
    private(set) var preparingProvider: SpeechProvider?
    private(set) var generation: UInt64 = 0
    private(set) var errorMessage: String?
    private let voices: SpeechVoiceMap
    private let backends: [SpeechProvider: any SpeechProviderBackend]
    private let defaults: UserDefaults
    private let preferenceKey: String
    private var preparation: Task<Void, Error>?
    private var requests: [UUID: SpeechSynthesis] = [:]

    init(voices: SpeechVoiceMap, boson: any SpeechProviderBackend,
         phonon: any SpeechProviderBackend, defaults: UserDefaults = .standard,
         preferenceKey: String = "speechProvider") {
        self.voices = voices
        backends = [.boson: boson, .phonon: phonon]
        self.defaults = defaults
        self.preferenceKey = preferenceKey
        preferredProvider = defaults.string(forKey: preferenceKey).flatMap(SpeechProvider.init) ?? .boson
        // A saved preference is not evidence that a provider is ready this launch.
    }

    @discardableResult
    func select(_ provider: SpeechProvider) async -> Bool {
        // A superseded warmup may resume after an uncooperative SDK/cooldown.
        // It must not invalidate the user's newer selection before noticing cancellation.
        guard !Task.isCancelled else { return false }
        generation &+= 1
        let selectedGeneration = generation
        let previous = preparation
        previous?.cancel()
        let draining = Array(requests.values)
        requests.removeAll()
        draining.forEach { $0.cancel() }
        preparingProvider = provider
        errorMessage = nil
        let backend = backends[provider]!
        let selectedVoices = voices.voices(for: provider)
        let task = Task {
            _ = await previous?.result
            for request in draining { await request.waitForCompletion() }
            try Task.checkCancellation()
            try await backend.prepare(voices: selectedVoices)
            try Task.checkCancellation()
        }
        preparation = task
        let result = await withTaskCancellationHandler {
            await task.result
        } onCancel: { task.cancel() }
        guard generation == selectedGeneration else { return false }
        preparation = nil
        preparingProvider = nil
        guard !Task.isCancelled else { return false }
        switch result {
        case .success:
            activeProvider = provider
            preferredProvider = provider
            defaults.set(provider.rawValue, forKey: preferenceKey)
            return true
        case .failure(let error):
            if !(error is CancellationError) { errorMessage = error.localizedDescription }
            return false
        }
    }

    func preparePreferred() async throws {
        try Task.checkCancellation()
        if activeProvider != nil, preparingProvider == nil { return }
        guard await select(preferredProvider) else {
            if let errorMessage { throw VoiceError(message: errorMessage) }
            throw CancellationError()
        }
    }

    func synthesize(_ text: String, characterID: String) async throws -> SpeechSynthesis {
        guard preparingProvider == nil, let provider = activeProvider else {
            throw VoiceError(message: "Choose a voice provider and wait for it to become ready.")
        }
        let expectedGeneration = generation
        let voice = try voices.voice(for: characterID, provider: provider)
        let request = try await backends[provider]!.synthesize(text, voice: voice)
        guard generation == expectedGeneration, !Task.isCancelled else {
            request.cancel()
            await request.waitForCompletion()
            throw CancellationError()
        }
        let id = UUID()
        requests[id] = request
        Task { [weak self] in
            await request.waitForCompletion()
            self?.requests.removeValue(forKey: id)
        }
        return request
    }

    /// The owner must also interrupt playback/generation and clear mouth poses.
    func unload() async {
        generation &+= 1
        let expectedGeneration = generation
        let old = preparation
        old?.cancel()
        let draining = Array(requests.values)
        requests.removeAll()
        draining.forEach { $0.cancel() }
        activeProvider = nil
        preparingProvider = nil
        let backends = self.backends
        let task = Task<Void, Error> {
            _ = await old?.result
            for request in draining { await request.waitForCompletion() }
            for backend in backends.values { await backend.unload() }
        }
        preparation = task
        _ = await task.result
        if generation == expectedGeneration { preparation = nil }
    }
}
