import Foundation

/// Public deployment addresses; no provider or shared bootstrap credentials are bundled.
enum HostedServiceConfiguration {
    static var managed: Bool { Bundle.main.object(forInfoDictionaryKey: "ManagedServiceAccess") as? Bool == true }

    static func address(_ key: String) -> URL? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              let url = URL(string: value), url.scheme == "https", url.host != nil,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return nil }
        return url
    }

    static func prepareForManagedLaunch() {
        guard managed, !UserDefaults.standard.bool(forKey: "hosted-access-migrated-v1") else { return }
        // An old local proxy failure may have left Phonon selected. Start the hosted
        // build with online voices once; subsequent explicit voice choices persist.
        UserDefaults.standard.set("boson", forKey: "speechProvider")
        UserDefaults.standard.set(true, forKey: "hosted-access-migrated-v1")
    }
}

final class HostedAccessNoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct HostedVoiceAccessError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

/// Anonymous, quota-limited demo access expires and renews without user setup.
/// Tokens are kept only in memory and are bound to the configured service URL.
actor HostedVoiceAccess {
    static let shared = HostedVoiceAccess()
    private struct Grant {
        let token: String
        let expires: Date
    }
    private var cached: (URL, Grant)?
    private var pending: (id: UUID, url: URL, task: Task<Grant, Error>)?
    private let network: URLSession

    init(network: URLSession? = nil) {
        if let network { self.network = network }
        else {
            let config = URLSessionConfiguration.ephemeral
            config.timeoutIntervalForRequest = 30
            config.timeoutIntervalForResource = 45
            config.urlCache = nil
            self.network = URLSession(configuration: config, delegate: HostedAccessNoRedirect(), delegateQueue: nil)
        }
    }

    func invalidate() {
        cached = nil
        pending?.task.cancel()
        pending = nil
    }

    func token(for base: URL) async throws -> String {
        guard base.scheme == "https", base.host != nil, base.user == nil,
              base.password == nil, base.query == nil, base.fragment == nil else {
            throw HostedVoiceAccessError(message: "The app's hosted voice connection is unavailable. Please update the app.")
        }
        if let (url, grant) = cached, url == base, grant.expires.timeIntervalSinceNow > 60 { return grant.token }
        if let existing = pending, existing.url == base {
            let grant = try await existing.task.value
            try Task.checkCancellation()
            // A successful owner may already have cached and cleared this request.
            // An invalidated/replaced request must never hand out its old grant.
            guard pending?.id == existing.id || (cached?.0 == base && cached?.1.token == grant.token) else {
                throw CancellationError()
            }
            return grant.token
        }
        invalidate()
        let id = UUID(), network = self.network
        let task = Task<Grant, Error> {
            var request = URLRequest(url: base.appendingPathComponent("v1/voice-sessions"))
            request.httpMethod = "POST"
            request.httpBody = Data("{}".utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let (data, response) = try await network.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            guard (200...299).contains(http.statusCode) else {
                throw HostedVoiceAccessError(message: http.statusCode == 429
                    ? "The shared demo is busy or has reached its daily voice allowance. Please try again later."
                    : "The voice service is temporarily unavailable. Please retry.")
            }
            guard data.count <= 16384,
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let token = json["token"] as? String, (32...512).contains(token.utf8.count),
                  token.utf8.allSatisfy({ $0 > 32 && $0 < 127 }),
                  let expiry = json["expires_at"] as? String else { throw URLError(.cannotParseResponse) }
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var expires = formatter.date(from: expiry)
            if expires == nil {
                formatter.formatOptions = [.withInternetDateTime]
                expires = formatter.date(from: expiry)
            }
            guard let expires, expires.timeIntervalSinceNow > 60,
                  expires.timeIntervalSinceNow <= 86400 else { throw URLError(.cannotParseResponse) }
            try Task.checkCancellation()
            return Grant(token: token, expires: expires)
        }
        pending = (id, base, task)
        defer { if pending?.id == id { pending = nil } }
        let grant = try await task.value
        guard pending?.id == id else { throw CancellationError() }
        cached = (base, grant)
        try Task.checkCancellation()
        return grant.token
    }
}
