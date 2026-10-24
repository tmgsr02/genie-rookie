import Foundation

enum SpeechProvider: String, CaseIterable, Identifiable, Sendable {
    case boson, phonon
    var id: String { rawValue }
    var title: String { self == .boson ? "Boson" : "Phonon" }
    var menuTitle: String { self == .boson ? "Boson · Online" : "Phonon · On device" }
}

/// Provider-specific identifiers never cross the adapter boundary. Boson values are
/// logical proxy keys, not provider credentials or arbitrary upstream voice IDs.
struct SpeechVoiceMap: Sendable {
    let boson: [String: String]
    let phonon: [String: String]

    func voices(for provider: SpeechProvider) -> [String] {
        Array(Set((provider == .boson ? boson : phonon).values)).sorted()
    }

    func voice(for characterID: String, provider: SpeechProvider) throws -> String {
        guard let voice = (provider == .boson ? boson : phonon)[characterID] else {
            throw VoiceError(message: "No \(provider.title) voice is configured for \(characterID).")
        }
        return voice
    }
}

@MainActor
protocol SpeechProviderBackend: AnyObject {
    func prepare(voices: [String]) async throws
    func synthesize(_ text: String, voice: String) async throws -> SpeechSynthesis
    func unload() async
}
