import Foundation
import Security

/// Provision an app-scoped proxy client token from the app's authenticated login
/// or trusted development setup. Never store the upstream BOSON_API_KEY here.
enum BosonProxyCredentials {
    private static var service: String { (Bundle.main.bundleIdentifier ?? "voice") + ".boson-proxy" }

    static func accessToken() async throws -> String {
        if HostedServiceConfiguration.managed {
            guard let url = HostedServiceConfiguration.address("BosonProxyURL") else {
                throw VoiceError(message: "The app's voice connection is missing. Please update the app.")
            }
            return try await HostedVoiceAccess.shared.token(for: url)
        }
        return try token()
    }

    static func invalidateManagedSession() async {
        if HostedServiceConfiguration.managed { await HostedVoiceAccess.shared.invalidate() }
    }

    static func token() throws -> String {
        #if DEBUG
        if let token = ProcessInfo.processInfo.environment["BOSON_PROXY_CLIENT_TOKEN"], !token.isEmpty {
            return token
        }
        #endif
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "client-session",
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var value: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess,
              let data = value as? Data, let token = String(data: data, encoding: .utf8), !token.isEmpty else {
            throw VoiceError(message: "Boson needs a proxy session. Sign in or provision a proxy client token, then Retry; or choose Phonon.")
        }
        return token
    }

    static func store(token: String) throws {
        guard !token.isEmpty else { throw VoiceError(message: "The proxy client token is empty.") }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service, kSecAttrAccount as String: "client-session"]
        let attributes: [String: Any] = [kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            guard SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess else {
                throw VoiceError(message: "Could not save the proxy session in Keychain.")
            }
        } else if status != errSecSuccess {
            throw VoiceError(message: "Could not update the proxy session in Keychain.")
        }
    }

    static var configuredURL: URL? {
        if HostedServiceConfiguration.managed { return HostedServiceConfiguration.address("BosonProxyURL") }
        #if DEBUG
        if let value = ProcessInfo.processInfo.environment["BOSON_PROXY_URL"] { return URL(string: value) }
        #endif
        if let value = UserDefaults.standard.string(forKey: "bosonProxyURL") { return URL(string: value) }
        return (Bundle.main.object(forInfoDictionaryKey: "BosonProxyURL") as? String).flatMap(URL.init(string:))
    }

    /// This preference is separate from gameplay reset and contains no credential.
    /// Adapters without an explicit URL override read it at request time.
    static func store(proxyURL: URL) throws {
        guard proxyURL.scheme == "https", proxyURL.host != nil,
              proxyURL.user == nil, proxyURL.password == nil,
              proxyURL.query == nil, proxyURL.fragment == nil else {
            throw VoiceError(message: "The Boson proxy URL must be HTTPS and contain no credentials or query.")
        }
        UserDefaults.standard.set(proxyURL.absoluteString, forKey: "bosonProxyURL")
    }
}
