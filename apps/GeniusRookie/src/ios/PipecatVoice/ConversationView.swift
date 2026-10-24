import AVFoundation
import SwiftUI

/// The conversation screen: the stage between a header (Settings, New conversation) and a dock
/// (input picker, microphone, End).
struct ConversationView: View {
    @Bindable var model: ConversationModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    /// Where the header ends and the footer starts, in window coordinates; the stage keeps its
    /// faces and captions between them.
    @State private var headerBottom: CGFloat = 0
    @State private var footerTop: CGFloat = .infinity
    /// The screen New conversation is wiping away.
    @State private var resetWipe: ResetWipeSnapshot?
    /// The launch intro is playing: the microphone fades in once it has.
    @State private var introPlaying = true
    /// The intro's logo shows.
    @State private var logoShown = false
    /// The first launch's welcome has been dismissed, on this launch or an earlier one.
    @State private var welcomeSeen = WelcomeCard.seen()
    @State private var showHistory = false
    @State private var question = ""
    #if DEBUG
    @State private var expandedExplainer = ProcessInfo.processInfo.arguments.contains("--explainer-expanded")
    #else
    @State private var expandedExplainer = false
    #endif
    @FocusState private var questionFocused: Bool

    private var connecting: Bool { model.loading || model.preparing || model.speechProviders.preparingProvider != nil }

    /// The header and dock, which a showreel leaves out.
    private var showsChrome: Bool {
        #if DEBUG
        !StageDebug.showreel
        #else
        true
        #endif
    }

    /// The welcome shows once the intro has played, until it is dismissed or a conversation starts.
    private var showsWelcome: Bool {
        #if DEBUG
        if stagePose != nil || StageDebug.showreel { return false }
        #endif
        return !welcomeSeen && !introPlaying && !model.active
    }

    /// The dock waits for the intro, then for the welcome.
    private var dockHidden: Bool { introPlaying || showsWelcome }

    init(model: ConversationModel) {
        self.model = model
    }

    #if DEBUG
    /// A settled stage pose drawn in place of the characters (`--stage-pose`).
    private var stagePose: StagePoseRequest?

    init(model: ConversationModel, stagePose: StagePoseRequest?) {
        self.model = model
        self.stagePose = stagePose
    }
    #endif

    var body: some View {
        GeometryReader { geometry in
            let stageHeight = min(210, max(190, geometry.size.height * 0.30))
            VStack(spacing: 0) {
                if !expandedExplainer { stage(height: stageHeight).frame(height: stageHeight).clipped() }
                if model.legacyLesson {
                    LessonSceneView(bridge: model.lesson).accessibilityLabel("Balance regression fixture")
                } else {
                    ExplainerView(controller: model.explainer, expanded: $expandedExplainer, showsDialogue: !model.active)
                }
            }
        }
        .background(WorkshopStyle.paper.ignoresSafeArea())
        .onAppear {
            if expandedExplainer { introPlaying = false; model.introEnded() }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            header.onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).maxY } action: { headerBottom = $0 }
                .opacity(showsChrome ? 1 : 0)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            footer.onGeometryChange(for: CGFloat.self) { $0.frame(in: .global).minY } action: { footerTop = $0 }
                .opacity(showsChrome ? 1 : 0)
        }
        .accessibilityHidden(showsWelcome)
        .overlay {
            if let resetWipe {
                ResetWipeView(snapshot: resetWipe, reduceMotion: reduceMotion) {
                    if self.resetWipe?.id == resetWipe.id { self.resetWipe = nil }
                }
                .id(resetWipe.id)
                .ignoresSafeArea()
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
        }
        .overlay {
            if showsWelcome {
                WelcomeCard(palette: palette, holdsToTalk: model.microphoneHolds) { dismissWelcome() }
                    .transition(.opacity)
            }
        }
        .animation(reduceMotion ? .easeInOut(duration: 0.25) : .spring(response: 0.45, dampingFraction: 0.8),
                   value: showsWelcome)
        // A conversation started another way, as by voice, has no need of it.
        .onChange(of: model.active) { _, active in if active { dismissWelcome() } }
        .tint(WorkshopStyle.teal)
        // No mute tick when ending a conversation clears the mute.
        .sensoryFeedback(.selection, trigger: model.muted) { _, _ in model.active }
        // New conversation's wipe taps in place of the conversation's end.
        .sensoryFeedback(.impact(flexibility: .soft), trigger: resetWipe?.id) { _, wipe in wipe != nil }
        // A conversation started by holding the microphone gets its tap as it starts listening.
        .sensoryFeedback(.impact(weight: .light), trigger: model.active) { _, active in
            resetWipe == nil && !(active && model.holdsToTalk)
        }
        .onChange(of: model.error) {
            if let error = model.errorMessage { AccessibilityNotification.Announcement("Error: \(error)").post() }
        }
        .sheet(isPresented: $model.showSettings) { SettingsView(model: model) }
        .sheet(isPresented: $showHistory) { HistoryView(archive: model.history, keeping: model.savesConversations, palette: palette) }
    }

    /// One VoiceOver container, read after the header and before the footer.
    @ViewBuilder
    private func stage(height: CGFloat) -> some View {
        Group {
            #if DEBUG
            DuoStageView(model: model, headerBottom: 0, footerTop: height, introPlaying: $introPlaying,
                         logoShown: $logoShown, pose: stagePose)
            #else
            DuoStageView(model: model, headerBottom: 0, footerTop: height, introPlaying: $introPlaying,
                         logoShown: $logoShown)
            #endif
        }
        .accessibilityElement(children: .contain)
        .accessibilitySortPriority(1)
        .onChange(of: introPlaying) { _, playing in if !playing { model.introEnded() } }
    }

    /// The stage's palette, which the chrome shares.
    private var palette: StagePalette {
        StagePalette(contrast: contrast, reduceTransparency: reduceTransparency)
    }

    /// Whether the dock shows its conversation controls: in a conversation, or inert under a
    /// `--stage-pose`.
    private var showsControls: Bool {
        #if DEBUG
        model.active || stagePose != nil
        #else
        model.active
        #endif
    }

    private var header: some View {
        HStack(spacing: 12) {
            Button { model.showSettings = true } label: {
                Image(systemName: "slider.horizontal.3")
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("Settings")
            Spacer(minLength: 0)
            Text("Genie & Rookie")
                .font(.system(.headline, design: .serif))
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 0)
            Button(action: newConversation) {
                Image(systemName: "square.and.pencil")
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel("New conversation")
            .accessibilityHint("Clears the conversation and starts a fresh one.")
            .disabled(!model.hasConversation && !model.active)
        }
        .foregroundStyle(WorkshopStyle.ink)
        .padding(.horizontal, 12)
        .padding(.vertical, 2)
        .background(WorkshopStyle.paper)
        .accessibilityElement(children: .contain)
        .accessibilitySortPriority(2)
    }

    private func dismissWelcome() {
        guard !welcomeSeen else { return }
        welcomeSeen = true
        WelcomeCard.markSeen()
    }

    /// Clears the conversation at once and wipes the old screen away over the fresh stage.
    private func newConversation() {
        let snapshot = ResetWipeSnapshot.capture()
        model.clearConversation()
        resetWipe = snapshot
    }

    /// A compact control shelf leaves the experiment the rest of the screen.
    private var footer: some View {
        VStack(spacing: 8) {
            if !model.legacyLesson {
                HStack(spacing: 8) {
                    TextField("Ask anything…", text: $question, axis: .vertical)
                        .lineLimit(1...3).focused($questionFocused)
                        .submitLabel(.send).onSubmit(sendQuestion)
                        .accessibilityLabel("Your question")
                    Button(action: sendQuestion) {
                        Image(systemName: "arrow.up").font(.headline)
                            .foregroundStyle(.white).frame(width: 40, height: 40)
                            .background(WorkshopStyle.teal, in: Circle())
                    }
                    .accessibilityLabel("Ask Genie and Rookie")
                    .disabled(question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.explainer.planning)
                }
                .padding(.leading, 14).padding(5)
                .background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 26))
            }
            if let error = model.errorMessage, !showsWelcome {
                errorBanner(error)
                    .transition(.opacity)
            }
            VoiceProviderFailureView(model: model)
                .font(.caption.weight(.semibold))
            HStack(spacing: 12) {
                VoiceProviderControl(model: model, showsFailure: false)
                Spacer(minLength: 0)
                dock
                    .opacity(dockHidden ? 0 : 1)
                    .allowsHitTesting(!dockHidden)
                    .accessibilityHidden(dockHidden)
                    .animation(.easeInOut(duration: 0.5), value: dockHidden)
            }
        }
        .frame(maxWidth: 520)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(WorkshopStyle.paper)
        .animation(reduceMotion ? nil : .smooth(duration: 0.3), value: showsControls)
        .animation(reduceMotion ? .linear(duration: 0.15) : .smooth(duration: 0.3), value: model.error)
        .accessibilityElement(children: .contain)
    }

    private func sendQuestion() {
        let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        question = ""; questionFocused = false; dismissWelcome()
        model.submitQuestion(text)
    }

    private var dock: some View {
        HStack(spacing: 6) {
            if showsControls || !model.history.conversations.isEmpty {
                Button { showHistory = true } label: {
                    Image(systemName: "bubble.left.and.text.bubble.right")
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("Conversations")
                .accessibilityHint("Shows the conversations kept on this device.")
            }
            DockMicrophone(model: model, connecting: connecting, palette: palette)
            if showsControls {
                Button(action: model.stop) {
                    Image(systemName: "phone.down.fill")
                        .frame(width: 44, height: 44)
                }
                .accessibilityLabel("End conversation")
            }
        }
        .foregroundStyle(WorkshopStyle.ink)
        .frame(height: 56)
    }

    /// Reads the input level in its own body, so level updates re-render only the button.
    private struct DockMicrophone: View {
        let model: ConversationModel
        let connecting: Bool
        let palette: StagePalette

        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            MicrophoneControl(level: model.userLevel, muted: model.muted, connecting: connecting,
                              active: model.active, holds: model.microphoneHolds, held: model.talking,
                              hearing: model.hearing, palette: palette) {
                if model.active { model.toggleMute() } else { model.start(holdingToTalk: false) }
            } onHold: { pressed in
                if pressed { model.pressMicrophone() } else { model.releaseMicrophone() }
            }
            .scaleEffect(54 / MicrophoneControl.diameter)
            .frame(width: 54, height: 54)
            .overlay(alignment: .top) {
                if model.showsHoldHint {
                    HoldToTalkHint(palette: palette)
                        .fixedSize()
                        .offset(y: -54)
                        .transition(reduceMotion ? .opacity
                            : .opacity.combined(with: .scale(scale: 0.85, anchor: .bottom)))
                }
            }
            .animation(reduceMotion ? .linear(duration: 0.15) : .smooth(duration: 0.25), value: model.showsHoldHint)
        }
    }

    /// The microphone has been refused, so the error offers the app's page in Settings.
    private var microphoneDenied: Bool {
        model.error != model.availability && AVAudioApplication.shared.recordPermission == .denied
    }

    /// Its text stops growing at the captions' largest size, so it never crowds the stage.
    private func errorBanner(_ error: String) -> some View {
        let palette = palette, colors = palette.colors
        return HStack(spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "exclamationmark.circle.fill")
                    .foregroundStyle(palette.color(colors.bannerGlyph))
                Text(error)
                    .foregroundStyle(palette.color(colors.bannerText))
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                Spacer(minLength: 0)
            }
            .font(.subheadline.weight(.medium)).fontDesign(.rounded)
            .padding(.vertical, 12)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Error")
            .accessibilityValue(error)
            if microphoneDenied {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
                .font(.subheadline.weight(.semibold)).fontDesign(.rounded)
                .foregroundStyle(palette.color(colors.bannerText))
                .padding(.horizontal, 6)
                .frame(minHeight: 44)
            }
            Button { model.error = nil } label: {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(palette.color(colors.bannerText).opacity(0.7))
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Dismiss error")
        }
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .padding(.leading, 16).padding(.trailing, 4)
        .softGlass(RoundedRectangle(cornerRadius: 20, style: .continuous), tint: colors.bannerTint, kind: .caption,
                   palette: palette, shadowRadius: 18)
    }
}

private extension View {
    /// Hidden outside a conversation: shrunk behind the microphone, with no touches or VoiceOver focus.
    func dockSideControl(shown: Bool) -> some View {
        scaleEffect(shown ? 1 : 0.6)
            .opacity(shown ? 1 : 0)
            .allowsHitTesting(shown)
            .accessibilityHidden(!shown)
    }
}

private struct SettingsView: View {
    let model: ConversationModel
    @Environment(\.dismiss) private var dismiss
    @State private var preferredName: String
    @State private var inputMode: InputMode
    @State private var savesConversations: Bool
    @State private var confirmingDeleteAll = false
    @State private var confirmingLessonRestart = false
    /// The audio session, set up for choosing a microphone while Settings is open.
    @State private var microphoneSession: AVAudioSession?
    @State private var showContactPicker = false
    @State private var contactNotice: String?
    @State private var error: String?

    init(model: ConversationModel) {
        self.model = model
        _preferredName = State(initialValue: model.userProfile.preferredName)
        _inputMode = State(initialValue: model.inputMode)
        _savesConversations = State(initialValue: model.savesConversations)
    }

    var body: some View {
        NavigationStack {
            Form {
                ExplainerConnectionSettings(controller: model.explainer).disabled(model.active)
                Section("Voice") {
                    VoiceProviderControl(model: model)
                    VoiceConnectionSettings(model: model)
                }
                Section {
                    TextField("Your name", text: $preferredName)
                        .textContentType(.givenName).textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                    if !preferredName.isEmpty {
                        Button("Clear name") { preferredName = ""; contactNotice = nil }
                    }
                    if let contactNotice { Text(contactNotice).foregroundStyle(.secondary) }
                } header: { Text("Optional nickname") } footer: {
                    Text("A nickname is optional and stored on this device. If characters say it while Boson is selected, it is sent online as part of their dialogue for speech. Do not use a full name.")
                }
                .disabled(model.active)
                Section {
                    Picker("Microphone", selection: $inputMode) {
                        ForEach(InputMode.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: { Text("Talking") } footer: {
                    Text(inputMode == .hold
                         ? "Hold the microphone while you talk, and let go when you’re done."
                         : "Tap the microphone once, then talk. The genius and the rookie answer when you pause.")
                }
                .disabled(model.active)
                Section {
                    MicrophoneInputPicker(session: microphoneSession) { presented in
                        if !presented, let microphoneSession { MicrophonePreference.remember(from: microphoneSession) }
                    }
                } header: { Text("Microphone") } footer: {
                    Text("The microphone your conversations use, and its Mic Mode, such as Voice Isolation.")
                }
                Section {
                    Toggle("Save child transcripts on this device", isOn: $savesConversations)
                    if model.legacyLesson { Button("Restart balance lesson", role: .destructive) { confirmingLessonRestart = true } }
                    Button("Delete All Conversations", role: .destructive) { confirmingDeleteAll = true }
                        .disabled(model.history.conversations.isEmpty)
                } header: { Text("Grown-up settings") } footer: {
                    Text("Off by default. Turning this on saves the words spoken in future conversations on this device. No audio is saved. Tutor sessions keep temporary context on the configured server.")
                }
                .confirmationDialog("Grown-up: restart this lesson?", isPresented: $confirmingLessonRestart,
                                    titleVisibility: .visible) {
                    Button("Clear learning progress and restart", role: .destructive) {
                        UserDefaults.standard.removeObject(forKey: "genius-rookie.lesson.balance_01.summary")
                        model.lesson.restart()
                        dismiss()
                    }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("This clears the saved completion flags and returns the balance lesson to its opening question. Please ask a grown-up to confirm.")
                }
                .confirmationDialog("Delete all conversations?", isPresented: $confirmingDeleteAll,
                                    titleVisibility: .visible) {
                    Button("Delete All Conversations", role: .destructive) { model.history.deleteAll() }
                } message: {
                    Text("Their transcripts are removed from this device.")
                }
                Section {
                    ForEach(DuoCharacter.allCases) { character in
                        LabeledContent("\(character.title)’s voice", value: Self.voiceName(character.voice))
                    }
                    LabeledContent("Language", value: "English (US)")
                } header: { Text("Voices") } footer: {
                    Text("Gradium Phonon generates speech audio on this device.")
                }
                Section {
                    NavigationLink("Set up a voice shortcut") { WakeShortcutSetupView() }
                } header: { Text("Hey Genius & Rookie") } footer: {
                    Text("Use Apple’s Vocal Shortcuts to open Genius & Rookie and start a conversation with your voice.")
                }
                Section {
                    LabeledContent("Speech recognition", value: "Apple Speech")
                    LabeledContent("Tutor planner", value: "Connected service")
                    LabeledContent("Speech synthesis", value: model.speechProviders.activeProvider?.menuTitle ?? "Not ready")
                    if let availability = model.availability {
                        Label(availability, systemImage: "info.circle")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                } header: { Text("On this device") } footer: {
                    Text("Typing does not require Apple Intelligence or microphone access. Apple speech assets may download on first use.")
                }
                Section("Credits") {
                    credit("Pipecat", detail: "Conversation by Pipecat, Daily’s open-source framework for voice AI.",
                           url: "https://pipecat.ai")
                    credit("Gradium", detail: "Speech by Phonon, Gradium’s on-device text-to-speech model.",
                           url: "https://gradium.ai")
                    NavigationLink("Acknowledgements") { AcknowledgementsView() }
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }.navigationTitle("Settings").navigationBarTitleDisplayMode(.inline)
                .onAppear { microphoneSession = model.sessionForMicrophoneChoice() }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            do {
                                try model.saveSettings(preferredName: preferredName, inputMode: inputMode,
                                                       savesConversations: savesConversations)
                                dismiss()
                            } catch { self.error = error.localizedDescription }
                        }.disabled(model.active)
                    }
                }
                .sheet(isPresented: $showContactPicker) {
                    ProfileContactPicker(onSelection: { name in
                        if name.isEmpty {
                            contactNotice = "That contact has no first name. Enter the name you’d like to use."
                        } else { preferredName = name; contactNotice = nil }
                        showContactPicker = false
                    }, onCancel: { showContactPicker = false })
                }
        }.tint(WorkshopStyle.teal)
    }

    /// A Phonon voice's name as people say it: Gradium's are language_region_Name, so
    /// `en_gb_Reuben` is Reuben; a custom voice such as `Angel_F01` is Genius F01.
    private static func voiceName(_ voice: String) -> String {
        let parts = voice.split(separator: "_")
        if parts.count == 3, parts[0].count == 2, parts[1].count == 2,
           parts[0].allSatisfy(\.isLowercase), parts[1].allSatisfy(\.isLowercase) {
            return String(parts[2])
        }
        return parts.joined(separator: " ")
    }

    private func credit(_ name: String, detail: String, url: String) -> some View {
        Link(destination: URL(string: url)!) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                Text(detail).font(.footnote).foregroundStyle(.secondary)
            }
        }
    }
}
