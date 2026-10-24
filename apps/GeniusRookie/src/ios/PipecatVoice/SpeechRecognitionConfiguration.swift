import Foundation
import Speech

/// Both Apple modules report timed text, so they share the same result and
/// finalization path without introducing another audio stream or clock.
protocol SpeechTranscriptionResult: SpeechModuleResult {
    var text: AttributedString { get }
}

extension SpeechTranscriber.Result: SpeechTranscriptionResult {}
extension DictationTranscriber.Result: SpeechTranscriptionResult {}

protocol OnDeviceTranscriber: SpeechModule where Result: SpeechTranscriptionResult {}
extension SpeechTranscriber: OnDeviceTranscriber {}
extension DictationTranscriber: OnDeviceTranscriber {}

/// Keep a conversation's chosen model and locale through each utterance rotation.
enum SpeechRecognitionConfiguration: Equatable {
    case speech(Locale)
    case dictation(Locale)

    static func resolve(
        speechAvailable: Bool = SpeechTranscriber.isAvailable,
        speechLocale: (Locale) async throws -> Locale? = { await SpeechTranscriber.supportedLocale(equivalentTo: $0) },
        dictationLocale: (Locale) async throws -> Locale? = { await DictationTranscriber.supportedLocale(equivalentTo: $0) }
    ) async rethrows -> Self? {
        let requested = Locale(identifier: "en-US")
        if speechAvailable, let locale = try await speechLocale(requested) {
            return .speech(locale)
        }
        if let locale = try await dictationLocale(requested) {
            return .dictation(locale)
        }
        return nil
    }

    var diagnosticName: String {
        switch self {
        case .speech(let locale): "SpeechTranscriber (\(locale.identifier))"
        case .dictation(let locale): "DictationTranscriber (\(locale.identifier))"
        }
    }

    func makeTranscriber() -> any OnDeviceTranscriber {
        switch self {
        case .speech(let locale):
            return SpeechTranscriber(locale: locale, preset: .timeIndexedProgressiveTranscription)
        case .dictation(let locale):
            return DictationTranscriber(locale: locale, contentHints: [], transcriptionOptions: [],
                reportingOptions: [.volatileResults], attributeOptions: [.audioTimeRange])
        }
    }
}
