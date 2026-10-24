import SwiftUI

struct ExplainerView: View {
    @Bindable var controller: ExplainerController
    @Binding var expanded: Bool
    var showsDialogue = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let scene = controller.activeScene {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(scene.package.title).font(.headline)
                        Text(provenance(scene.package.provenance)).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if scene.supportsPause {
                        Button { scene.togglePause() } label: {
                            Image(systemName: scene.paused ? "play" : "pause").frame(width: 44, height: 44)
                        }.accessibilityLabel(scene.paused ? "Resume animation" : "Pause animation")
                    }
                    Button { expanded.toggle() } label: {
                        Image(systemName: expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                            .frame(width: 44, height: 44)
                    }.accessibilityLabel(expanded ? "Show characters" : "Expand explanation")
                }
            }
            ZStack {
                if controller.activeScene == nil {
                    VStack(alignment: .leading, spacing: 18) {
                        Image(systemName: "sparkle.magnifyingglass").font(.system(size: 30)).foregroundStyle(WorkshopStyle.teal)
                        Text("What are you\ncurious about?")
                            .font(.system(size: 32, weight: .medium, design: .serif))
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Ask a question. We’ll find a way to explore it together.")
                            .font(.body).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Try an idea, change something,\nand tell Rookie what you notice.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .padding(24)
                }
                ExplainerWebSurface(controller: controller)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.white.opacity(0.35), in: RoundedRectangle(cornerRadius: 20))
            .clipShape(.rect(cornerRadius: 20))
            if showsDialogue, !controller.lastDialogue.isEmpty {
                ScrollView {
                    Text(controller.lastDialogue.map { line in
                        let name = line["speaker"] == "rookie" ? "Rookie" : "Genie"
                        return "\(name): \(line["text"] ?? "")"
                    }.joined(separator: "\n\n"))
                    .font(.subheadline).frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                }.frame(maxHeight: 90).fixedSize(horizontal: false, vertical: true)
            }
            if controller.busy || !controller.phaseTitle.isEmpty {
                HStack(spacing: 10) {
                    if controller.busy { ProgressView().controlSize(.small).accessibilityHidden(true) }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(controller.phaseTitle).font(.subheadline)
                        if let progress = controller.progress {
                            Text(progress.elapsedTitle)
                                .font(.caption).monospacedDigit().foregroundStyle(.secondary)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityElement(children: .combine)
                    Spacer(minLength: 0)
                    if controller.jobID != nil && controller.pendingScene == nil { Button("Cancel", action: controller.cancel).font(.subheadline.weight(.semibold)).frame(minHeight: 44) }
                }
                .accessibilityElement(children: .contain)
            }
            if let notice = controller.notice {
                Text(notice).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if let scene = controller.activeScene {
                let limitations = scene.package.manifest["limitations"] as? [String] ?? []
                if !limitations.isEmpty {
                    DisclosureGroup("About this explanation") {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(scene.package.manifest["model_kind"] as? String ?? "Illustrative model").fontWeight(.medium)
                            ForEach(limitations, id: \.self) { Text($0) }
                        }.font(.caption).foregroundStyle(.secondary)
                    }.font(.caption)
                }
            }
        }
        .foregroundStyle(WorkshopStyle.ink)
        .padding(.horizontal, 16).padding(.bottom, 6)
    }

    private func provenance(_ source: String) -> String {
        switch source {
        case "cache": "From a checked explanation"
        case "configured": "Prepared reference"
        default: "Created for your question"
        }
    }
}

struct ExplainerConnectionSettings: View {
    let controller: ExplainerController
    @State private var endpoint = ""
    @State private var token = ""
    @State private var saved = false
    @State private var error: String?

    var body: some View {
        if !HostedServiceConfiguration.managed {
        Section {
            TextField("https://your-tutor-service", text: $endpoint)
                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                .accessibilityLabel("Tutor service address")
            SecureField("Service access token (optional)", text: $token)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button(saved ? "Connection saved" : "Save tutor connection") {
                do { try controller.saveConnection(endpoint: endpoint, token: token); saved = true; error = nil }
                catch { self.error = error.localizedDescription }
            }
            if let error { Text(error).foregroundStyle(.red).font(.footnote) }
            if let diagnostic = controller.diagnostic { DisclosureGroup("Connection details") { Text(diagnostic).font(.footnote).textSelection(.enabled) } }
        } header: { Text("Grown-up: tutor connection") } footer: {
            Text("Questions and scene interactions go to this service to plan explanations. New explanations need internet with either Boson or Phonon. Provider API keys belong on the server. The access token stays in memory for this launch. Raw audio is not sent to the tutor service. Changing the connection starts a new tutor session.")
        }
        .onAppear { endpoint = controller.client.endpoint; token = controller.client.bootstrapToken }
        .onChange(of: endpoint) { saved = false }
        .onChange(of: token) { saved = false }
        }
    }
}
