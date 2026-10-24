import Foundation
import Observation

/// Cloud orchestration is independent of the selected speech synthesizer.
@MainActor @Observable
final class ExplainerClient {
    var endpoint = ExplainerClient.defaultEndpoint(
        overriding: UserDefaults.standard.string(forKey: "explainer.endpoint")
    )
    var bootstrapToken = ""
    private(set) var sessionID: String?
    private var sessionToken = ""
    private var sessionTask: Task<Void, Error>?
    private var epoch = UUID()
    var onSessionExpired: (() -> Void)?
    private let network: URLSession

    init(network: URLSession? = nil) {
        if let network { self.network = network; return }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 45
        config.timeoutIntervalForResource = 60
        config.urlCache = nil
        self.network = URLSession(configuration: config, delegate: HostedAccessNoRedirect(), delegateQueue: nil)
    }

    var configured: Bool { !endpoint.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    private static func defaultEndpoint(overriding value: String?) -> String {
        if HostedServiceConfiguration.managed {
            return HostedServiceConfiguration.address("TutorServiceURL")?.absoluteString ?? ""
        }
        if let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
            return value
        }
        if let value = Bundle.main.object(forInfoDictionaryKey: "TutorServiceURL") as? String,
           !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        // Judges may also use Debug Simulator builds: a bundled hosted URL always wins.
        #if DEBUG && targetEnvironment(simulator)
        return "http://127.0.0.1:8787"
        #else
        return ""
        #endif
    }

    func save(endpoint: String, token: String) throws {
        let value = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty { _ = try Self.validateURL(value) }
        let resolved = Self.defaultEndpoint(overriding: value)
        if self.endpoint != resolved || bootstrapToken != token { reset() }
        self.endpoint = resolved
        bootstrapToken = HostedServiceConfiguration.managed ? "" : token
        if value.isEmpty { UserDefaults.standard.removeObject(forKey: "explainer.endpoint") }
        else { UserDefaults.standard.set(value, forKey: "explainer.endpoint") }
    }

    private static func validateURL(_ value: String) throws -> URL {
        guard let url = URL(string: value), let host = url.host,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)) else {
            throw VoiceError(message: "Use an HTTPS tutor service address. Local Simulator development also supports localhost.")
        }
        return url
    }

    func reset() {
        epoch = UUID()
        sessionTask?.cancel(); sessionTask = nil
        sessionID = nil; sessionToken = ""
    }

    func ensureSession() async throws {
        if sessionID != nil { return }
        if let sessionTask { return try await sessionTask.value }
        let currentEpoch = epoch
        let task = Task { @MainActor in
            let response = try await self.request(path: "v1/sessions", body: [:], sessionAuth: false)
            guard self.epoch == currentEpoch else { throw CancellationError() }
            guard let id = response["session_id"] as? String, let token = response["session_token"] as? String else {
                throw VoiceError(message: "The tutor service returned an invalid session.")
            }
            self.sessionID = id; self.sessionToken = token
        }
        sessionTask = task
        defer { if epoch == currentEpoch { sessionTask = nil } }
        try await task.value
    }

    func call(_ route: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        try await ensureSession()
        guard let sessionID else { throw CancellationError() }
        return try await request(path: "v1/sessions/\(sessionID)/\(route)", body: body)
    }

    private func request(path: String, body: [String: Any]?, sessionAuth: Bool = true) async throws -> [String: Any] {
        let currentEpoch = epoch
        let base = try Self.validateURL(endpoint)
        guard let url = URL(string: path, relativeTo: URL(string: base.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/")!) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let token = sessionAuth ? sessionToken : bootstrapToken
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        let (data, response) = try await network.data(for: request)
        try Task.checkCancellation()
        guard epoch == currentEpoch else { throw CancellationError() }
        if sessionAuth, (response as? HTTPURLResponse)?.statusCode == 401 {
            // Scene identities and queued commands belong to this expired session.
            // Let their owner clear them before obtaining a fresh anonymous grant.
            reset()
            onSessionExpired?()
            throw CancellationError()
        }
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode), data.count <= 8_000_000,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw VoiceError(message: "The tutor service could not complete that request.")
        }
        return json
    }
}
