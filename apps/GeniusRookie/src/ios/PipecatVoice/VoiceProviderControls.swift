import SwiftUI

/// The provider remains available even when speech or Apple Intelligence cannot start.
struct VoiceProviderControl: View {
    let model: ConversationModel
    var showsFailure = true

    private var provider: SpeechProvider {
        model.speechProviders.preparingProvider ?? model.speechProviders.activeProvider
            ?? model.speechProviders.preferredProvider
    }

    private var status: String {
        if model.speechProviders.preparingProvider != nil { return "Preparing voice" }
        return model.speechProviders.activeProvider == nil ? "Voice not ready" : "Voice"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Menu {
                ForEach(SpeechProvider.allCases) { provider in
                    Button { model.selectSpeechProvider(provider) } label: {
                        if model.speechProviders.activeProvider == provider {
                            Label(provider.menuTitle, systemImage: "checkmark")
                        } else { Text(provider.menuTitle) }
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "waveform")
                    VStack(alignment: .leading, spacing: 1) {
                        Text(status).font(.caption)
                        Text(provider.title).font(.subheadline.weight(.semibold))
                    }
                    Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
                }
                .foregroundStyle(WorkshopStyle.ink)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .accessibilityIdentifier("voice-provider")
            .accessibilityLabel("\(status), \(provider.title)")
            .accessibilityHint("Choose Boson online speech or bundled Phonon on-device speech.")
            if showsFailure { VoiceProviderFailureView(model: model) }
        }
    }
}

struct VoiceProviderFailureView: View {
    let model: ConversationModel

    private var bosonFailed: Bool {
        model.failedProvider == .boson || (model.failedProvider == nil && model.speechProviders.preferredProvider == .boson)
    }

    var body: some View {
        if let failure = model.voiceFailure ?? model.speechProviders.errorMessage {
            VStack(alignment: .leading, spacing: 4) {
                failureLabel(failure)
                HStack(spacing: 12) { recoveryActions }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.top, 10)
            .background(WorkshopStyle.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityElement(children: .contain)
        }
    }

    private func failureLabel(_ failure: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(bosonFailed ? "Boson unavailable" : "Voice unavailable")
                .font(.caption.weight(.semibold))
            Text(failure)
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(WorkshopStyle.ink)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var recoveryActions: some View {
        if bosonFailed {
            Button("Settings") { model.showSettings = true }
                .frame(minHeight: 44)
                .accessibilityLabel("Open voice settings")
            Button("Use Phonon") { model.selectSpeechProvider(.phonon) }
                .frame(minHeight: 44)
        }
        Button("Retry") { model.selectSpeechProvider(bosonFailed ? .boson : model.failedProvider ?? .phonon) }
            .frame(minWidth: 44, minHeight: 44)
            .accessibilityLabel(bosonFailed ? "Retry Boson" : "Retry voice")
    }
}
