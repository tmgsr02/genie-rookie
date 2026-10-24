import Foundation

private struct CheckFailure: Error { let message: String }
private func check(_ value: @autoclosure () -> Bool, _ message: String) throws {
    if !value() { throw CheckFailure(message: message) }
}

@main
struct SpeechRecognitionChecks {
    static func main() async throws {
        let english = Locale(identifier: "en-US")
        let equivalent = Locale(identifier: "en-CA")

        // A phone without the newer model must still be able to use local dictation.
        let olderDevice = try await SpeechRecognitionConfiguration.resolve(
            speechAvailable: false,
            speechLocale: { _ in throw CheckFailure(message: "Queried unavailable model") },
            dictationLocale: { _ in english })
        try check(olderDevice == .dictation(english), "Unavailable SpeechTranscriber must fall back to dictation")

        let newerDevice = try await SpeechRecognitionConfiguration.resolve(
            speechAvailable: true,
            speechLocale: { _ in english },
            dictationLocale: { _ in throw CheckFailure(message: "Queried unnecessary fallback") })
        try check(newerDevice == .speech(english), "Prefer the newer model when supported")

        let localeFallback = try await SpeechRecognitionConfiguration.resolve(
            speechAvailable: true,
            speechLocale: { _ in nil },
            dictationLocale: { requested in
                try check(requested == english, "Resolve English for the fallback")
                return equivalent
            })
        try check(localeFallback == .dictation(equivalent), "Retain the fallback's supported equivalent locale")

        let unsupported = try await SpeechRecognitionConfiguration.resolve(
            speechAvailable: false, speechLocale: { _ in nil }, dictationLocale: { _ in nil })
        try check(unsupported == nil, "Report unavailable only when neither local model supports English")
        let unsupportedLocale = try await SpeechRecognitionConfiguration.resolve(
            speechAvailable: true, speechLocale: { _ in nil }, dictationLocale: { _ in nil })
        try check(unsupportedLocale == nil, "A supported device still needs a supported locale")
        print("SPEECH_RECOGNITION_CHECKS_PASSED")
    }
}
