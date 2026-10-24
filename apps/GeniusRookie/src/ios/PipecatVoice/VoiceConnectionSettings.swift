import SwiftUI

/// Account provisioning for a private demo proxy; the Boson provider key never enters the app.
struct VoiceConnectionSettings: View {
    let model: ConversationModel
    @State private var address = BosonProxyCredentials.configuredURL?.absoluteString ?? ""
    @State private var accessCode = ""
    @State private var message: String?

    var body: some View {
        if !HostedServiceConfiguration.managed {
        DisclosureGroup("Online voice connection") {
            TextField("HTTPS server address", text: $address)
                .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
            SecureField("App access code", text: $accessCode)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("Save and use Boson") {
                do {
                    guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
                          url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
                          url.query == nil, url.fragment == nil else {
                        throw VoiceError(message: "Enter a valid HTTPS server address.")
                    }
                    if !accessCode.isEmpty { try BosonProxyCredentials.store(token: accessCode) }
                    try BosonProxyCredentials.store(proxyURL: url)
                    accessCode = ""
                    message = nil
                    model.selectSpeechProvider(.boson)
                } catch { message = error.localizedDescription }
            }
            Text("Use the app access code supplied by your server administrator. This is not a Boson API key. Character dialogue is sent to this server for online speech.")
                .font(.caption).foregroundStyle(.secondary)
            if let message { Text(message).font(.caption).foregroundStyle(.red) }
        }
        }
    }
}
