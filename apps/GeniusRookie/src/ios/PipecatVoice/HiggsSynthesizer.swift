import Foundation

/// Refuse redirects so the proxy token cannot be forwarded to another origin.
private final class BosonNoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor
final class HiggsSynthesizer: SpeechProviderBackend {
    private let proxyURL: URL?
    private let appID: String
    private let tokenProvider: @Sendable () async throws -> String

    init(appID: String, proxyURL: URL? = nil,
         tokenProvider: @escaping @Sendable () async throws -> String = { try await BosonProxyCredentials.accessToken() }) {
        self.appID = appID
        self.proxyURL = proxyURL
        self.tokenProvider = tokenProvider
    }

    private func request(path: String, body: Data? = nil) async throws -> URLRequest {
        guard let proxyURL = proxyURL ?? BosonProxyCredentials.configuredURL,
              proxyURL.scheme == "https", proxyURL.host != nil,
              proxyURL.user == nil, proxyURL.password == nil,
              proxyURL.query == nil, proxyURL.fragment == nil else {
            throw VoiceError(message: "Boson isn’t set up. Open Settings → Voice → Online voice connection to add the service address and app access code, or choose Phonon.")
        }
        let token = try await tokenProvider()
        guard !token.isEmpty, !token.contains("\n"), !token.contains("\r") else {
            throw VoiceError(message: "The proxy session is invalid. Sign in again or choose Phonon.")
        }
        var request = URLRequest(url: proxyURL.appendingPathComponent(path))
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(appID, forHTTPHeaderField: "X-App-ID")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body
        return request
    }

    private nonisolated static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 180
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: BosonNoRedirect(), delegateQueue: nil)
    }

    private nonisolated static func check(_ response: URLResponse) async throws -> HTTPURLResponse {
        guard let response = response as? HTTPURLResponse else {
            throw VoiceError(message: "The Boson proxy returned an invalid response. Retry or choose Phonon.")
        }
        guard response.statusCode == 200 else {
            if response.statusCode == 401 || response.statusCode == 403 {
                await BosonProxyCredentials.invalidateManagedSession()
            }
            let reason: String
            switch response.statusCode {
            case 401, 403: reason = "The voice session expired. Tap Retry to reconnect."
            case 429: reason = "The voice service is busy. Wait a moment and Retry."
            case 503: reason = "The server needs a valid BOSON_API_KEY and voice configuration."
            default: reason = "The voice service could not complete the request (HTTP \(response.statusCode)). Retry."
            }
            throw VoiceError(message: "Boson is unavailable. \(reason) Or choose Phonon.")
        }
        return response
    }

    func prepare(voices: [String]) async throws {
        let request = try await request(path: "v1/ready")
        let session = Self.session()
        defer { session.invalidateAndCancel() }
        try await withTaskCancellationHandler {
            let (data, response) = try await session.data(for: request)
            _ = try await Self.check(response)
            struct Readiness: Decodable { let voices: [String] }
            let ready = try JSONDecoder().decode(Readiness.self, from: data)
            guard Set(voices).isSubset(of: Set(ready.voices)) else {
                throw VoiceError(message: "The Boson proxy is missing a character voice. Configure both voices, then Retry.")
            }
            try Task.checkCancellation()
        } onCancel: { session.invalidateAndCancel() }
    }

    func synthesize(_ text: String, voice: String) async throws -> SpeechSynthesis {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.unicodeScalars.count <= 2000 else {
            throw VoiceError(message: "Speech must contain between 1 and 2,000 characters.")
        }
        struct Payload: Encodable { let text: String; let voice: String }
        let body = try JSONEncoder().encode(Payload(text: text, voice: voice))
        let request = try await request(path: "v1/speech", body: body)
        return SpeechSynthesis { continuation in
            let session = Self.session()
            defer { session.invalidateAndCancel() }
            try await withTaskCancellationHandler {
                let (bytes, response) = try await session.bytes(for: request)
                let http = try await Self.check(response)
                guard http.value(forHTTPHeaderField: "X-Audio-Format") == "pcm_s16le",
                      http.value(forHTTPHeaderField: "X-Audio-Sample-Rate") == "24000",
                      http.value(forHTTPHeaderField: "X-Audio-Channels") == "1" else {
                    throw VoiceError(message: "The proxy returned an unsupported audio format. Expected 24 kHz mono PCM16.")
                }
                var decoder = PCM16StreamDecoder()
                var chunk: [UInt8] = []
                var byteCount = 0
                for try await byte in bytes {
                    try Task.checkCancellation()
                    byteCount += 1
                    guard byteCount <= 8_640_000 else {
                        throw VoiceError(message: "The speech response exceeded the three-minute limit.")
                    }
                    chunk.append(byte)
                    if chunk.count == 2048 {
                        if case .terminated = continuation.yield(decoder.append(chunk)) { throw CancellationError() }
                        chunk.removeAll(keepingCapacity: true)
                    }
                }
                try Task.checkCancellation()
                let remaining = decoder.append(chunk)
                try decoder.finish()
                guard byteCount > 0 else { throw VoiceError(message: "Boson returned no audio. Retry or choose Phonon.") }
                if !remaining.isEmpty { continuation.yield(remaining) }
            } onCancel: { session.invalidateAndCancel() }
        }
    }

    func unload() async {} // Each synthesis owns its own URLSession and cancellation.
}
