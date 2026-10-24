import Foundation

@MainActor
final class PhononProviderBackend: SpeechProviderBackend {
    private let synthesizer = PhononSynthesizer()
    func prepare(voices: [String]) async throws { try await synthesizer.prepare(voices: voices) }
    func synthesize(_ text: String, voice: String) async throws -> SpeechSynthesis {
        try await synthesizer.synthesize(text, voice: voice)
    }
    func unload() async { await synthesizer.unload() }
}
